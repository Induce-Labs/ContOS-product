import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useDashboardPolling } from '../hooks/useDashboardPolling'
import {
  fetchUserProjects,
  resolveActiveProject,
  setLastUsedProjectId,
  type Project,
} from '../lib/projects'
import { DashboardSidebar } from '../components/dashboard/DashboardSidebar'
import { CompetitorProgressCard } from '../components/dashboard/CompetitorProgressCard'
import { CompetitorSummaryCard } from '../components/dashboard/CompetitorSummaryCard'
import { AddCompetitorPanel } from '../components/dashboard/AddCompetitorPanel'
import type { Competitor } from '../lib/competitors'
import type { ContentSummary } from '../lib/summaries'

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

  const {
    competitors,
    summariesByCompetitorId,
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
    <div className="flex min-h-screen flex-col bg-canvas">
      <DashboardHeader
        userEmail={user?.email}
        isSigningOut={isSigningOut}
        onSignOut={() => void handleSignOut()}
      />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <DashboardSidebar
          projects={projects}
          activeProject={activeProject}
          competitors={competitors}
          selectedCompetitorId={activeCompetitorId}
          onSelectCompetitor={setSelectedCompetitorId}
          onAddCompetitor={() => setIsAddCompetitorOpen(true)}
          isAddCompetitorOpen={isAddCompetitorOpen}
        />

        <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {projectsError || dashboardError ? (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {projectsError ?? dashboardError}
            </div>
          ) : null}

          {activeProject ? (
            <div className="mx-auto max-w-4xl space-y-6">
              <header>
                <p className="text-sm text-ink-muted capitalize">{activeProject.type.replace('_', ' ')}</p>
                <h1 className="text-2xl font-semibold text-ink">{activeProject.name}</h1>
                <p className="mt-1 text-sm capitalize text-ink-muted">
                  Project status: {activeProject.status}
                </p>
              </header>

              {isAddCompetitorOpen ? (
                <AddCompetitorPanel
                  projectId={activeProject.id}
                  existingCompetitors={competitors}
                  onClose={() => setIsAddCompetitorOpen(false)}
                  onSuccess={() => void refresh()}
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
                      summary={summariesByCompetitorId.get(competitor.id) ?? null}
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
  userEmail: string | undefined
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
  summary: ContentSummary | null
}

function CompetitorDashboardSection({ competitor, summary }: CompetitorDashboardSectionProps) {
  const isDone = competitor.pipeline_step === 'done' && summary !== null

  if (isDone) {
    return <CompetitorSummaryCard competitor={competitor} summaryRecord={summary} />
  }

  return <CompetitorProgressCard competitor={competitor} />
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
