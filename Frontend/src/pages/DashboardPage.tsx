import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { useDashboardPolling } from '../hooks/useDashboardPolling'
import { useDashboardShell } from '../hooks/useDashboardShell'
import { updateProjectStatus } from '../lib/projects'
import { enqueueCompetitorScrapeJobsOrThrow, stopCompetitorPipeline } from '../lib/api'
import { requeueOrphanedCompetitorScrapes } from '../lib/requeueOrphanedScrapes'
import { DashboardLayout, EmptyProjectsState } from '../components/dashboard/DashboardLayout'
import { CompetitorProgressCard } from '../components/dashboard/CompetitorProgressCard'
import { AddCompetitorPanel } from '../components/dashboard/AddCompetitorPanel'
import { OverviewWorkspaceHeader } from '../components/dashboard/OverviewWorkspaceHeader'
import { CompetitorWorkspacePanel } from '../components/dashboard/CompetitorWorkspacePanel'
import type { Competitor } from '../lib/competitors'

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
  } = useDashboardShell()
  const navigate = useNavigate()
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null)
  const [isAddCompetitorOpen, setIsAddCompetitorOpen] = useState(false)
  const [retryingCompetitorId, setRetryingCompetitorId] = useState<string | null>(null)
  const [stoppingCompetitorId, setStoppingCompetitorId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const redirectedToAgentsRef = useRef<string | null>(null)

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

  useEffect(() => {
    if (!activeProject || dashboardLoading) {
      return
    }

    const hasInProgress = competitors.some(
      (competitor) =>
        competitor.pipeline_step !== 'done' && competitor.pipeline_step !== 'failed',
    )
    const hasCompleted = competitors.some(
      (competitor) => competitor.pipeline_step === 'done',
    )
    const isReady =
      activeProject.status === 'ready' || (hasCompleted && !hasInProgress)

    if (!isReady || !hasCompleted) {
      return
    }

    if (redirectedToAgentsRef.current === activeProject.id) {
      return
    }

    redirectedToAgentsRef.current = activeProject.id
    navigate(`/dashboard/${activeProject.id}/agents`, { replace: true })
  }, [activeProject, competitors, dashboardLoading, navigate])

  async function handleRetryCompetitor(competitorId: string) {
    if (!activeProject) {
      return
    }

    setActionError(null)
    setRetryingCompetitorId(competitorId)
    redirectedToAgentsRef.current = null

    try {
      await updateProjectStatus(activeProject.id, 'scraping')
      await enqueueCompetitorScrapeJobsOrThrow(activeProject.id, [competitorId])
      await refresh()
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('dashboard.retryFailed'),
      )
    } finally {
      setRetryingCompetitorId(null)
    }
  }

  async function handleStopCompetitor(competitorId: string) {
    if (!activeProject) {
      return
    }

    setActionError(null)
    setStoppingCompetitorId(competitorId)

    try {
      await stopCompetitorPipeline(activeProject.id, competitorId)
      await refresh()
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('dashboard.stopFailed'),
      )
    } finally {
      setStoppingCompetitorId(null)
    }
  }

  const isLoading = projectsLoading || (activeProject !== null && dashboardLoading)
  const activeCompetitorId =
    selectedCompetitorId &&
    competitors.some((competitor) => competitor.id === selectedCompetitorId)
      ? selectedCompetitorId
      : (competitors[0]?.id ?? null)
  const visibleCompetitors = activeCompetitorId
    ? competitors.filter((competitor) => competitor.id === activeCompetitorId)
    : competitors
  const failedCompetitorCount = competitors.filter(
    (competitor) => competitor.pipeline_step === 'failed',
  ).length
  const completedCompetitorCount = competitors.filter(
    (competitor) => competitor.pipeline_step === 'done',
  ).length
  const hasPartialFailure =
    failedCompetitorCount > 0 &&
    completedCompetitorCount > 0 &&
    activeProject?.status === 'ready'

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
        mainClassName="overflow-y-auto px-4 py-8 sm:px-8"
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
      mainClassName="overflow-y-auto px-4 pb-8 sm:px-8"
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
              <p className="text-sm capitalize text-ink-muted">
                {activeProject.type.replaceAll('_', ' ')}
              </p>
              <h2 className="text-xl font-semibold text-ink">{activeProject.name}</h2>
              <p className="mt-1 text-sm text-ink-muted">
                {t('dashboard.projectStatus', { status: activeProject.status })}
              </p>
            </div>
            {completedCompetitorCount > 0 ? (
              <Link
                to={`/dashboard/${activeProject.id}/agents`}
                className="rounded-full bg-accent-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-primary-deep"
              >
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

          {hasPartialFailure ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {t('dashboard.partialFailure', { count: failedCompetitorCount })}
            </div>
          ) : null}

          {isAddCompetitorOpen ? (
            <AddCompetitorPanel
              projectId={activeProject.id}
              existingCompetitors={competitors}
              onClose={() => setIsAddCompetitorOpen(false)}
              onSuccess={() => {
                redirectedToAgentsRef.current = null
                void refresh()
              }}
            />
          ) : null}

          {competitors.length === 0 ? (
            <section className="rounded-[2rem] border border-dashed border-border-hairline bg-white/80 p-8 text-center">
              <p className="text-sm text-ink-muted">{t('dashboard.noCompetitors')}</p>
            </section>
          ) : (
            <div className="space-y-8">
              {visibleCompetitors.map((competitor) => (
                <CompetitorDashboardSection
                  key={competitor.id}
                  competitor={competitor}
                  projectId={activeProject.id}
                  onRetry={(competitorId) => void handleRetryCompetitor(competitorId)}
                  onStop={(competitorId) => void handleStopCompetitor(competitorId)}
                  isRetrying={retryingCompetitorId === competitor.id}
                  isStopping={stoppingCompetitorId === competitor.id}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <section className="rounded-[2rem] border border-border-hairline bg-white p-8">
          <p className="text-sm text-ink-muted">{t('dashboard.selectProject')}</p>
        </section>
      )}
    </DashboardLayout>
  )
}

type CompetitorDashboardSectionProps = {
  competitor: Competitor
  projectId: string
  onRetry?: (competitorId: string) => void
  onStop?: (competitorId: string) => void
  isRetrying?: boolean
  isStopping?: boolean
}

function CompetitorDashboardSection({
  competitor,
  projectId,
  onRetry,
  onStop,
  isRetrying = false,
  isStopping = false,
}: CompetitorDashboardSectionProps) {
  const { t } = useTranslation()

  if (competitor.pipeline_step === 'done') {
    return (
      <section className="rounded-[2rem] border border-white/80 bg-white p-6 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-8">
        <p className="text-xs font-medium uppercase tracking-wide text-signal-positive">
          {t('dashboard.researchReadyEyebrow')}
        </p>
        <h2 className="mt-2 font-serif text-2xl text-ink">
          {t('dashboard.researchFinishedTitle')}
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          {competitor.error_message?.includes('stopped early')
            ? `${competitor.error_message}${t('dashboard.researchFinishedPartialSuffix')}`
            : t('dashboard.researchFinishedBody')}
        </p>
        <Link
          to={`/dashboard/${projectId}/agents`}
          className="mt-6 inline-block rounded-full bg-accent-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-primary-deep"
        >
          {t('dashboard.openChat')}
        </Link>
      </section>
    )
  }

  return (
    <CompetitorProgressCard
      competitor={competitor}
      onRetry={onRetry}
      onStop={onStop}
      isRetrying={isRetrying}
      isStopping={isStopping}
    />
  )
}

export function DashboardRedirectPage() {
  return <DashboardPage />
}
