import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  fetchUserProjects,
  resolveActiveProject,
  setLastUsedProjectId,
  type Project,
} from '../lib/projects'

export function DashboardPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadProjects() {
      setIsLoading(true)
      setErrorMessage(null)

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
          setErrorMessage('Project not found or you do not have access to it.')
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
          setErrorMessage(
            error instanceof Error ? error.message : 'Failed to load dashboard',
          )
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
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
    setErrorMessage(null)

    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Sign out failed')
      setIsSigningOut(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-ink-muted">
        Loading dashboard…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-border-hairline bg-canvas-raised">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-sm font-medium text-accent-primary">ContOS</p>
            <h1 className="text-lg font-semibold text-ink">Dashboard</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link
              to="/projects/new"
              className="rounded-xl bg-accent-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-primary-deep"
            >
              New project
            </Link>
            <span className="text-sm text-ink-muted">{user?.email}</span>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              className="rounded-xl border border-border-hairline px-4 py-2 text-sm text-ink transition hover:bg-accent-primary-soft disabled:opacity-60"
            >
              {isSigningOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {errorMessage ? (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        ) : null}

        {projects.length === 0 ? (
          <EmptyProjectsState />
        ) : (
          <ProjectDashboardPreview project={activeProject} projectCount={projects.length} />
        )}
      </main>
    </div>
  )
}

function EmptyProjectsState() {
  return (
    <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-10 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-accent-primary">
        Step 01
      </p>
      <h2 className="mt-3 text-2xl font-semibold text-ink">Create your first project</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm text-ink-muted">
        Projects organize the competitors you track and the intelligence ContOS generates
        for your brand or business.
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

type ProjectDashboardPreviewProps = {
  project: Project | null
  projectCount: number
}

function ProjectDashboardPreview({ project, projectCount }: ProjectDashboardPreviewProps) {
  if (!project) {
    return (
      <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8">
        <p className="text-sm text-ink-muted">Select a project to continue.</p>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <div className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8">
        <p className="text-sm text-ink-muted">
          {projectCount} project{projectCount === 1 ? '' : 's'} available
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-ink">{project.name}</h2>
        <p className="mt-2 text-sm capitalize text-ink-muted">
          {project.type.replace('_', ' ')} · {project.status}
        </p>
        <p className="mt-6 text-sm text-ink-muted">
          Competitors are queued for research. Progress cards and summaries arrive in Phase 5.
        </p>
      </div>

      <div className="rounded-[2rem] border border-dashed border-border-hairline bg-canvas-raised/60 p-8 text-sm text-ink-muted">
        Sidebar layout, competitor list, and pipeline progress cards will be added in Phase 5.
      </div>
    </section>
  )
}

export function DashboardRedirectPage() {
  return <DashboardPage />
}
