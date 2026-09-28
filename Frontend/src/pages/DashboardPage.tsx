import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDashboardPolling } from '../hooks/useDashboardPolling'
import { useDashboardShell } from '../hooks/useDashboardShell'
import { updateProjectStatus } from '../lib/projects'
import {
  enqueueCompetitorScrapeJobsOrThrow,
  stopCompetitorPipeline,
} from '../lib/api'
import { deleteCompetitor, type Competitor } from '../lib/competitors'
import { requeueOrphanedCompetitorScrapes } from '../lib/requeueOrphanedScrapes'
import type { PipelineStep, ProjectStatus } from '../types/contos'
import { DashboardLayout, EmptyProjectsState } from '../components/dashboard/DashboardLayout'
import { AddCompetitorPanel } from '../components/dashboard/AddCompetitorPanel'
import { WorkspaceOverview } from '../components/dashboard/WorkspaceOverview'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { displayCompetitorHandle } from '../lib/instagram-display'
import { fetchScrapedPostCounts } from '../lib/scrapedPostCounts'
import { summaryPostCount } from '../lib/workspaceMetrics'

type DeleteDialogState = {
  competitorId: string
  handle: string
} | null

function isPipelineInProgress(step: string): boolean {
  return step !== 'done' && step !== 'failed' && step !== 'queued'
}

function deriveProjectStatusFromCompetitors(
  competitors: Competitor[],
  storedStatus: ProjectStatus | string,
): ProjectStatus | string {
  if (competitors.length === 0) {
    return storedStatus
  }

  const hasInProgress = competitors.some(
    (competitor) =>
      competitor.pipeline_step !== 'done' && competitor.pipeline_step !== 'failed',
  )
  if (hasInProgress) {
    return 'scraping'
  }

  if (competitors.every((competitor) => competitor.pipeline_step === 'failed')) {
    return 'failed'
  }

  if (competitors.some((competitor) => competitor.pipeline_step === 'done')) {
    return 'ready'
  }

  return storedStatus
}

export function DashboardPage() {
  const { t } = useTranslation()
  const {
    user,
    projects,
    setProjects,
    activeProject,
    projectsLoading,
    projectsError,
    isSigningOut,
    sidebarOpen,
    setSidebarOpen,
    handleSignOut,
    refreshProjects,
  } = useDashboardShell()
  const [isAddCompetitorOpen, setIsAddCompetitorOpen] = useState(false)
  const [retryingCompetitorId, setRetryingCompetitorId] = useState<string | null>(null)
  const [deletingCompetitorId, setDeletingCompetitorId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null)

  const {
    competitors,
    summariesByCompetitorId,
    isLoading: dashboardLoading,
    errorMessage: dashboardError,
    refresh,
  } = useDashboardPolling(activeProject?.id ?? null)
  const [scrapedCounts, setScrapedCounts] = useState<Map<string, number> | null>(null)
  const [scrapedCountError, setScrapedCountError] = useState<string | null>(null)

  const missingSummaryKey = useMemo(
    () =>
      competitors
        .filter((competitor) => !summariesByCompetitorId.has(competitor.id))
        .map(
          (competitor) =>
            `${competitor.id}|${competitor.last_scraped_at ?? ''}|${competitor.pipeline_step}`,
        )
        .sort()
        .join(','),
    [competitors, summariesByCompetitorId],
  )

  useEffect(() => {
    const ids =
      missingSummaryKey.length === 0
        ? []
        : missingSummaryKey.split(',').map((part) => part.slice(0, part.indexOf('|')))
    if (ids.length === 0) {
      setScrapedCounts(new Map())
      setScrapedCountError(null)
      return
    }

    let cancelled = false
    setScrapedCounts(null)
    setScrapedCountError(null)

    void fetchScrapedPostCounts(ids)
      .then((counts) => {
        if (!cancelled) {
          setScrapedCounts(counts)
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setScrapedCounts(null)
          setScrapedCountError(
            error instanceof Error ? error.message : t('dashboard.scrapedCountFailed'),
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [missingSummaryKey, t])

  // Celery tasks are fire-and-forget in Redis. If the worker dies or Redis is
  // flushed, rows stay pending/queued forever — re-publish once per session.
  useEffect(() => {
    if (!activeProject?.id || dashboardLoading || competitors.length === 0) {
      return
    }
    void requeueOrphanedCompetitorScrapes(activeProject.id, competitors)
  }, [activeProject?.id, competitors, dashboardLoading])

  // Avatar.status can lag behind competitor pipeline_step (shell is not polled).
  // Keep the row in sync when every competitor has finished.
  useEffect(() => {
    if (!activeProject || dashboardLoading || competitors.length === 0) {
      return
    }

    const derived = deriveProjectStatusFromCompetitors(
      competitors,
      activeProject.status,
    )
    if (derived === activeProject.status) {
      return
    }
    if (derived !== 'ready' && derived !== 'failed') {
      return
    }

    const avatarId = activeProject.id
    const nextStatus = derived
    let cancelled = false

    async function syncStatus() {
      try {
        await updateProjectStatus(avatarId, nextStatus)
        if (!cancelled) {
          await refreshProjects()
        }
      } catch (error) {
        if (!cancelled) {
          setActionError(
            error instanceof Error
              ? error.message
              : t('dashboard.retryFailed'),
          )
        }
      }
    }

    void syncStatus()

    return () => {
      cancelled = true
    }
  }, [activeProject, competitors, dashboardLoading, refreshProjects, t])

  async function handleRetryCompetitor(competitorId: string) {
    if (!activeProject) {
      return
    }

    setActionError(null)
    setRetryingCompetitorId(competitorId)

    try {
      await updateProjectStatus(activeProject.id, 'scraping')
      await enqueueCompetitorScrapeJobsOrThrow(activeProject.id, [competitorId])
      await refresh()
      await refreshProjects()
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('dashboard.retryFailed'),
      )
    } finally {
      setRetryingCompetitorId(null)
    }
  }

  function requestDeleteCompetitor(competitorId: string) {
    const competitor = competitors.find((entry) => entry.id === competitorId)
    setDeleteDialog({
      competitorId,
      handle: competitor?.handle_or_url ?? competitorId,
    })
  }

  async function executeDeleteCompetitor(competitorId: string) {
    if (!activeProject) {
      return
    }

    const competitor = competitors.find((entry) => entry.id === competitorId)

    setActionError(null)
    setDeletingCompetitorId(competitorId)

    try {
      if (competitor && isPipelineInProgress(competitor.pipeline_step as PipelineStep)) {
        try {
          await stopCompetitorPipeline(activeProject.id, competitorId)
        } catch {
          // Best-effort stop; delete still removes the row and CASCADE context.
        }
      }

      await deleteCompetitor(competitorId)

      setDeleteDialog(null)
      await refresh()
      await refreshProjects()
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('dashboard.deleteFailed'),
      )
    } finally {
      setDeletingCompetitorId(null)
    }
  }

  const isLoading = projectsLoading || (activeProject !== null && dashboardLoading)
  const summaryReadError = competitors
    .filter((competitor) => {
      const summary = summariesByCompetitorId.get(competitor.id)
      return summary !== undefined && summaryPostCount(summary.summary) === null
    })
    .map((competitor) =>
      t('dashboard.summaryUnreadable', {
        handle: displayCompetitorHandle(competitor.handle_or_url, competitor.platform),
      }),
    )
    .join(' ')
  const pageError =
    [projectsError, dashboardError, actionError, scrapedCountError, summaryReadError]
      .filter((message) => message)
      .join(' ') || null

  if (!isLoading && projects.length === 0) {
    return (
      <DashboardLayout
        projects={projects}
        activeProject={null}
        onAvatarsChanged={setProjects}
        userEmail={user?.email}
        isSigningOut={isSigningOut}
        onSignOut={() => void handleSignOut()}
        sidebarOpen={sidebarOpen}
        onSidebarOpenChange={setSidebarOpen}
        mainClassName="overflow-x-hidden overflow-y-auto overscroll-none bg-white px-4 pb-4 pt-4 sm:px-8 sm:pt-6 dark:bg-canvas"
      >
        <EmptyProjectsState />
      </DashboardLayout>
    )
  }

  return (
    <DashboardLayout
      projects={projects}
      activeProject={activeProject}
      onAvatarsChanged={setProjects}
      userEmail={user?.email}
      isSigningOut={isSigningOut}
      onSignOut={() => void handleSignOut()}
      sidebarOpen={sidebarOpen}
      onSidebarOpenChange={setSidebarOpen}
      isLoading={isLoading}
      mainClassName="overflow-x-hidden overflow-y-auto overscroll-none bg-white px-4 pb-4 pt-4 sm:px-8 sm:pt-6 dark:bg-canvas"
    >
      {pageError ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {pageError}
        </div>
      ) : null}

      {activeProject ? (
        <div className="space-y-6">
          <WorkspaceOverview
            projectId={activeProject.id}
            competitors={competitors}
            summariesByCompetitorId={summariesByCompetitorId}
            scrapedCounts={scrapedCounts}
            scrapedQueryFailed={scrapedCountError !== null}
            onAddCompetitor={() => setIsAddCompetitorOpen(true)}
            isAddCompetitorOpen={isAddCompetitorOpen}
            onRetry={(competitorId) => void handleRetryCompetitor(competitorId)}
            onDelete={requestDeleteCompetitor}
            retryingCompetitorId={retryingCompetitorId}
            deletingCompetitorId={deletingCompetitorId}
          />

          {isAddCompetitorOpen ? (
            <AddCompetitorPanel
              projectId={activeProject.id}
              existingCompetitors={competitors}
              onClose={() => setIsAddCompetitorOpen(false)}
              onSuccess={() => {
                void refresh()
              }}
            />
          ) : null}
        </div>
      ) : (
        <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8">
          <p className="text-sm text-ink-muted">{t('dashboard.selectProject')}</p>
        </section>
      )}

      <ConfirmDialog
        open={deleteDialog !== null}
        title={t('competitors.deleteDialog.title')}
        description={t('competitors.deleteDialog.body', {
          handle: deleteDialog?.handle ?? '',
        })}
        confirmLabel={t('competitors.deleteDialog.confirm')}
        confirming={
          deleteDialog !== null && deletingCompetitorId === deleteDialog.competitorId
        }
        onConfirm={() => {
          if (deleteDialog) {
            void executeDeleteCompetitor(deleteDialog.competitorId)
          }
        }}
        onCancel={() => {
          if (!deletingCompetitorId) {
            setDeleteDialog(null)
          }
        }}
      />
    </DashboardLayout>
  )
}

export function DashboardRedirectPage() {
  return <DashboardPage />
}
