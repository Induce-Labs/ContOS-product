import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useDashboardPolling } from '../hooks/useDashboardPolling'
import { useDashboardShell } from '../hooks/useDashboardShell'
import { updateProjectStatus } from '../lib/projects'
import {
  enqueueCompetitorScrapeJobsOrThrow,
  stopCompetitorPipeline,
} from '../lib/api'
import {
  deleteCompetitor,
  MAX_COMPETITORS_PER_AVATAR,
  type Competitor,
} from '../lib/competitors'
import { requeueOrphanedCompetitorScrapes } from '../lib/requeueOrphanedScrapes'
import type { PipelineStep, ProjectStatus } from '../types/contos'
import { DashboardLayout, EmptyProjectsState } from '../components/dashboard/DashboardLayout'
import { CompetitorProgressCard } from '../components/dashboard/CompetitorProgressCard'
import { AddCompetitorPanel } from '../components/dashboard/AddCompetitorPanel'
import { OverviewWorkspaceHeader } from '../components/dashboard/OverviewWorkspaceHeader'
import { CompetitorWorkspacePanel } from '../components/dashboard/CompetitorWorkspacePanel'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ChatIcon, TrashIcon } from '../components/icons/ActionIcons'

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
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null)
  const [isAddCompetitorOpen, setIsAddCompetitorOpen] = useState(false)
  const [retryingCompetitorId, setRetryingCompetitorId] = useState<string | null>(null)
  const [deletingCompetitorId, setDeletingCompetitorId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null)

  const {
    competitors,
    isLoading: dashboardLoading,
    errorMessage: dashboardError,
    refresh,
  } = useDashboardPolling(activeProject?.id ?? null)

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

      if (selectedCompetitorId === competitorId) {
        setSelectedCompetitorId(null)
      }

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
  const activeCompetitorId =
    selectedCompetitorId &&
    competitors.some((competitor) => competitor.id === selectedCompetitorId)
      ? selectedCompetitorId
      : (competitors[0]?.id ?? null)
  const completedCompetitorCount = competitors.filter(
    (competitor) => competitor.pipeline_step === 'done',
  ).length
  const displayStatus = activeProject
    ? deriveProjectStatusFromCompetitors(competitors, activeProject.status)
    : null
  const remainingSlots = Math.max(0, MAX_COMPETITORS_PER_AVATAR - competitors.length)

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
        mainClassName="overflow-y-auto px-4 pb-8 pt-4 sm:px-8 sm:pt-6"
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
      mainClassName="overflow-y-auto px-4 pb-8 pt-4 sm:px-8 sm:pt-6"
    >
      {projectsError || dashboardError || actionError ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {projectsError || dashboardError || actionError}
        </div>
      ) : null}

      {activeProject ? (
        <div className="space-y-6">
          <OverviewWorkspaceHeader
            title={t('dashboard.workspaceTitle')}
            subtitle={t('dashboard.workspaceSubtitle')}
          />

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="font-serif text-2xl leading-none text-ink sm:text-3xl">
                {activeProject.name}
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                {t('dashboard.projectStatus', {
                  status: displayStatus ?? activeProject.status,
                })}
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {t('analytics.tracked', {
                  count: competitors.length,
                  max: MAX_COMPETITORS_PER_AVATAR,
                })}
                {remainingSlots > 0 ? t('analytics.slotsLeft', { count: remainingSlots }) : ''}
              </p>
            </div>
            {completedCompetitorCount > 0 ? (
              <Link
                to={`/dashboard/${activeProject.id}/agents`}
                className="contos-btn contos-btn--pill contos-btn--primary"
              >
                <ChatIcon />
                {t('dashboard.openChat')}
              </Link>
            ) : null}
          </div>

          <CompetitorWorkspacePanel
            competitors={competitors}
            selectedCompetitorId={activeCompetitorId}
            onSelectCompetitor={setSelectedCompetitorId}
            onAddCompetitor={() => setIsAddCompetitorOpen(true)}
            isAddCompetitorOpen={isAddCompetitorOpen}
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

          {competitors.length === 0 ? (
            <section className="rounded-[2rem] border border-dashed border-border-hairline bg-canvas-raised/80 p-8 text-center">
              <p className="text-sm text-ink-muted">{t('dashboard.noCompetitors')}</p>
            </section>
          ) : (
            <div className="space-y-8">
              {competitors.map((competitor) => (
                <CompetitorDashboardSection
                  key={competitor.id}
                  competitor={competitor}
                  projectId={activeProject.id}
                  onRetry={(competitorId) => void handleRetryCompetitor(competitorId)}
                  onDelete={requestDeleteCompetitor}
                  isRetrying={retryingCompetitorId === competitor.id}
                  isDeleting={deletingCompetitorId === competitor.id}
                />
              ))}
            </div>
          )}
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

type CompetitorDashboardSectionProps = {
  competitor: Competitor
  projectId: string
  onRetry?: (competitorId: string) => void
  onDelete?: (competitorId: string) => void
  isRetrying?: boolean
  isDeleting?: boolean
}

function CompetitorDashboardSection({
  competitor,
  projectId,
  onRetry,
  onDelete,
  isRetrying = false,
  isDeleting = false,
}: CompetitorDashboardSectionProps) {
  const { t } = useTranslation()

  if (competitor.pipeline_step === 'done') {
    return (
      <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-8">
        <p className="text-xs font-medium uppercase tracking-wide text-signal-positive">
          {t('dashboard.researchReadyEyebrow')}
        </p>
        <h2 className="mt-2 font-serif text-2xl text-ink">
          {t('dashboard.researchFinishedTitle')}
        </h2>
        <p className="mt-1 text-sm font-medium text-ink">{competitor.handle_or_url}</p>
        <p className="mt-2 text-sm text-ink-muted">
          {competitor.error_message?.includes('stopped early')
            ? `${competitor.error_message}${t('dashboard.researchFinishedPartialSuffix')}`
            : t('dashboard.researchFinishedBody')}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            to={`/dashboard/${projectId}/agents`}
            className="contos-btn contos-btn--pill contos-btn--primary"
          >
            <ChatIcon />
            {t('dashboard.openChat')}
          </Link>
          {onDelete ? (
            <button
              type="button"
              onClick={() => onDelete(competitor.id)}
              disabled={isDeleting}
              className="contos-btn contos-btn--pill contos-btn--secondary text-ink-muted hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              <TrashIcon />
              {isDeleting
                ? t('competitors.progressCard.deleting')
                : t('competitors.progressCard.delete')}
            </button>
          ) : null}
        </div>
      </section>
    )
  }

  return (
    <CompetitorProgressCard
      competitor={competitor}
      onRetry={onRetry}
      onDelete={onDelete}
      isRetrying={isRetrying}
      isDeleting={isDeleting}
    />
  )
}

export function DashboardRedirectPage() {
  return <DashboardPage />
}
