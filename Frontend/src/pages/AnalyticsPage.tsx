import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AddCompetitorPanel } from '../components/dashboard/AddCompetitorPanel'
import { CompetitorProgressCard } from '../components/dashboard/CompetitorProgressCard'
import { CompetitorSummaryCard } from '../components/dashboard/CompetitorSummaryCard'
import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { OverviewWorkspaceHeader } from '../components/dashboard/OverviewWorkspaceHeader'
import { useDashboardPolling } from '../hooks/useDashboardPolling'
import { useDashboardShell } from '../hooks/useDashboardShell'
import { enqueueCompetitorScrapeJobsOrThrow, stopCompetitorPipeline } from '../lib/api'
import { MAX_COMPETITORS_PER_AVATAR } from '../lib/competitors'
import { updateProjectStatus } from '../lib/projects'
import { requeueOrphanedCompetitorScrapes } from '../lib/requeueOrphanedScrapes'

export function AnalyticsPage() {
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

  const { competitors, summariesByCompetitorId, isLoading, errorMessage, refresh } =
    useDashboardPolling(activeProject?.id ?? null)

  const [isAddCompetitorOpen, setIsAddCompetitorOpen] = useState(false)
  const [retryingCompetitorId, setRetryingCompetitorId] = useState<string | null>(null)
  const [stoppingCompetitorId, setStoppingCompetitorId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!activeProject?.id || isLoading || competitors.length === 0) {
      return
    }
    void requeueOrphanedCompetitorScrapes(activeProject.id, competitors)
  }, [activeProject?.id, competitors, isLoading])

  const atCompetitorCap = competitors.length >= MAX_COMPETITORS_PER_AVATAR
  const remainingSlots = Math.max(0, MAX_COMPETITORS_PER_AVATAR - competitors.length)

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
      isLoading={projectsLoading || isLoading}
      mainClassName="overflow-y-auto px-4 pb-8 sm:px-8"
    >
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <OverviewWorkspaceHeader
          className="mb-0"
          title={t('analytics.title')}
          subtitle={t('analytics.subtitle')}
        />
        {activeProject ? (
          <button
            type="button"
            onClick={() => setIsAddCompetitorOpen(true)}
            disabled={atCompetitorCap || isAddCompetitorOpen}
            title={
              atCompetitorCap
                ? t('onboarding.competitors.maxReached', { max: MAX_COMPETITORS_PER_AVATAR })
                : undefined
            }
            className="shrink-0 rounded-full bg-accent-primary px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-primary-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAddCompetitorOpen ? t('competitors.addingCompetitor') : t('competitors.addCompetitor')}
          </button>
        ) : null}
      </div>

      <p className="mb-6 text-sm text-ink-muted">
        {t('analytics.tracked', {
          count: competitors.length,
          max: MAX_COMPETITORS_PER_AVATAR,
        })}
        {remainingSlots > 0 ? t('analytics.slotsLeft', { count: remainingSlots }) : ''}
      </p>

      {projectsError || errorMessage || actionError ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {projectsError || errorMessage || actionError}
        </div>
      ) : null}

      {activeProject && isAddCompetitorOpen ? (
        <div className="mb-6">
          <AddCompetitorPanel
            projectId={activeProject.id}
            existingCompetitors={competitors}
            onClose={() => setIsAddCompetitorOpen(false)}
            onSuccess={() => {
              void refresh()
            }}
          />
        </div>
      ) : null}

      {!activeProject ? (
        <section className="rounded-[2rem] border border-border-hairline bg-white p-8">
          <p className="text-sm text-ink-muted">{t('dashboard.selectProject')}</p>
        </section>
      ) : competitors.length === 0 ? (
        <section className="rounded-[2rem] border border-dashed border-border-hairline bg-white/80 p-8 text-center">
          <p className="text-sm text-ink-muted">{t('analytics.noCompetitors')}</p>
        </section>
      ) : (
        <div className="space-y-8">
          {competitors.map((competitor) => {
            const summary = summariesByCompetitorId.get(competitor.id)
            const isDone = competitor.pipeline_step === 'done'

            if (isDone && summary) {
              return (
                <CompetitorSummaryCard
                  key={competitor.id}
                  competitor={competitor}
                  summaryRecord={summary}
                />
              )
            }

            if (isDone && !summary) {
              return (
                <section
                  key={competitor.id}
                  className="rounded-[2rem] border border-border-hairline bg-white p-6"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-signal-positive">
                    {t('analytics.researchFinishedEyebrow')}
                  </p>
                  <p className="mt-2 text-sm font-medium text-ink">{competitor.handle_or_url}</p>
                  <p className="mt-2 text-sm text-ink-muted">{t('analytics.summaryPending')}</p>
                </section>
              )
            }

            return (
              <CompetitorProgressCard
                key={competitor.id}
                competitor={competitor}
                onRetry={(competitorId) => void handleRetryCompetitor(competitorId)}
                onStop={(competitorId) => void handleStopCompetitor(competitorId)}
                isRetrying={retryingCompetitorId === competitor.id}
                isStopping={stoppingCompetitorId === competitor.id}
              />
            )
          })}
        </div>
      )}
    </DashboardLayout>
  )
}
