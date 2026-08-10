import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDashboardPolling } from '../hooks/useDashboardPolling'
import {
  fetchUserProjects,
  resolveActiveProject,
  setLastUsedProjectId,
  updateProjectStatus,
  type Project,
} from '../lib/projects'
import { enqueueCompetitorScrapeJobsOrThrow, stopCompetitorPipeline } from '../lib/api'
import { DashboardSidebar } from '../components/dashboard/DashboardSidebar'
import { CompetitorProgressCard } from '../components/dashboard/CompetitorProgressCard'
import { AddCompetitorPanel } from '../components/dashboard/AddCompetitorPanel'
import type { Competitor } from '../lib/competitors'

export function DashboardPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null)
  const [isAddCompetitorOpen, setIsAddCompetitorOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
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

  useEffect(() => {
    let isMounted = true

    async function loadProjects() {
      setProjectsLoading(true)
      setProjectsError(null)

      try {
        const userProjects = await fetchUserProjects()

        if (!isMounted) {
          return
        }

        setProjects(userProjects)

        if (userProjects.length === 0) {
          setActiveProject(null)
          return
        }

        const selectedProject = projectId
          ? userProjects.find((project) => project.id === projectId) ?? null
          : resolveActiveProject(userProjects)

        if (projectId && !selectedProject) {
          setProjectsError('Project not found or you do not have access to it.')
          setActiveProject(resolveActiveProject(userProjects))
          return
        }

        if (selectedProject) {
          setActiveProject(selectedProject)
          setLastUsedProjectId(selectedProject.id)

          if (!projectId) {
            navigate(`/dashboard/${selectedProject.id}`, { replace: true })
          }
        }
      } catch (error) {
        if (isMounted) {
          setProjectsError(
            error instanceof Error ? error.message : 'Failed to load dashboard',
          )
        }
      } finally {
        if (isMounted) {
          setProjectsLoading(false)
        }
      }
    }

    void loadProjects()

    return () => {
      isMounted = false
    }
  }, [navigate, projectId])

  // Chat-first: when research becomes ready, send user to Agents once.
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
        error instanceof Error ? error.message : 'Failed to retry competitor research.',
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
        error instanceof Error ? error.message : 'Failed to stop competitor research.',
      )
    } finally {
      setStoppingCompetitorId(null)
    }
  }

  async function handleSignOut() {
    setIsSigningOut(true)

    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : 'Sign out failed')
      setIsSigningOut(false)
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

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-ink-muted">
        Loading dashboard…
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="min-h-screen bg-canvas">
        <DashboardHeader
          userEmail={user?.email}
          isSigningOut={isSigningOut}
          onSignOut={() => void handleSignOut()}
        />
        <main className="mx-auto max-w-3xl px-6 py-10">
          <EmptyProjectsState />
        </main>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <DashboardHeader
        userEmail={user?.email}
        isSigningOut={isSigningOut}
        onSignOut={() => void handleSignOut()}
      />

      <div className="flex min-h-0 flex-1 flex-row">
        <DashboardSidebar
          projects={projects}
          activeProject={activeProject}
          competitors={competitors}
          selectedCompetitorId={activeCompetitorId}
          onSelectCompetitor={setSelectedCompetitorId}
          onAddCompetitor={() => setIsAddCompetitorOpen(true)}
          isAddCompetitorOpen={isAddCompetitorOpen}
        />

        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          {projectsError || dashboardError || actionError ? (
            <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {projectsError || dashboardError || actionError}
            </div>
          ) : null}

          {activeProject ? (
            <div className="space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm capitalize text-ink-muted">
                    {activeProject.type.replace('_', ' ')}
                  </p>
                  <h2 className="text-2xl font-semibold text-ink">{activeProject.name}</h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Project status: <span className="capitalize">{activeProject.status}</span>
                  </p>
                </div>
                {completedCompetitorCount > 0 ? (
                  <Link
                    to={`/dashboard/${activeProject.id}/agents`}
                    className="rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-primary-deep"
                  >
                    Open chat
                  </Link>
                ) : null}
              </div>

              {hasPartialFailure ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Some competitors finished research, but {failedCompetitorCount} failed. Use Retry
                  on failed cards, or open chat for completed competitors.
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
                <section className="rounded-[2rem] border border-dashed border-border-hairline bg-canvas-raised p-8 text-center">
                  <p className="text-sm text-ink-muted">
                    No competitors in this project yet. Use &quot;Add competitor&quot; in the
                    sidebar to start research.
                  </p>
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
            <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8">
              <p className="text-sm text-ink-muted">Select a project from the sidebar.</p>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}

type DashboardHeaderProps = {
  userEmail?: string | null
  isSigningOut: boolean
  onSignOut: () => void
}

function DashboardHeader({ userEmail, isSigningOut, onSignOut }: DashboardHeaderProps) {
  return (
    <header className="border-b border-border-hairline bg-canvas-raised">
      <div className="flex items-center justify-between px-4 py-4 sm:px-6">
        <div>
          <p className="text-sm font-medium text-accent-primary">ContOS</p>
          <h1 className="text-lg font-semibold text-ink">Command center</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-ink-muted sm:inline">{userEmail}</span>
          <button
            type="button"
            onClick={onSignOut}
            disabled={isSigningOut}
            className="rounded-xl border border-border-hairline px-4 py-2 text-sm text-ink transition hover:bg-accent-primary-soft disabled:opacity-60"
          >
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </header>
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
  if (competitor.pipeline_step === 'done') {
    return (
      <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6 sm:p-8">
        <p className="text-xs font-medium uppercase tracking-wide text-signal-positive">
          Research ready
        </p>
        <h2 className="mt-2 text-xl font-semibold text-ink">Competitor research finished</h2>
        <p className="mt-2 text-sm text-ink-muted">
          {competitor.error_message?.includes('stopped early')
            ? `${competitor.error_message} Open chat to use that partial research.`
            : "Open chat to ask for strategies, content ideas, or comparisons grounded in this competitor's data."}
        </p>
        <Link
          to={`/dashboard/${projectId}/agents`}
          className="mt-6 inline-block rounded-xl bg-accent-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-primary-deep"
        >
          Open chat
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

function EmptyProjectsState() {
  return (
    <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-10 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-accent-primary">Step 01</p>
      <h2 className="mt-3 text-2xl font-semibold text-ink">Create your first project</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm text-ink-muted">
        Projects organize the competitors you track and the intelligence ContOS generates for your
        brand or business.
      </p>
      <Link
        to="/projects/new"
        className="mt-8 inline-block rounded-xl bg-accent-primary px-5 py-3 text-sm font-medium text-white transition hover:bg-accent-primary-deep"
      >
        New project
      </Link>
    </section>
  )
}

export function DashboardRedirectPage() {
  return <DashboardPage />
}
