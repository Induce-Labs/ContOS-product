import { Link } from 'react-router-dom'
import { MAX_AVATARS } from '../../lib/avatars'
import { DashboardSidebarNav } from './DashboardSidebarNav'
import { DashboardTopBar } from './DashboardTopBar'
import type { Project } from '../../lib/projects'
import type { ReactNode } from 'react'

type DashboardLayoutProps = {
  children: ReactNode
  projects: Project[]
  activeProject: Project | null
  onAvatarsChanged: (projects: Project[]) => void
  userEmail?: string | null
  isSigningOut: boolean
  onSignOut: () => void
  sidebarOpen: boolean
  onSidebarOpenChange: (open: boolean) => void
  mainClassName?: string
  isLoading?: boolean
}

export function DashboardLayout({
  children,
  projects,
  activeProject,
  onAvatarsChanged,
  userEmail,
  isSigningOut,
  onSignOut,
  sidebarOpen,
  onSidebarOpenChange,
  mainClassName = '',
  isLoading = false,
}: DashboardLayoutProps) {
  const projectId = activeProject?.id ?? null
  const atAvatarCap = projects.length >= MAX_AVATARS

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-ink-muted">
        Loading workspace…
      </div>
    )
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-[radial-gradient(circle_at_bottom_left,_#f3ecff_0%,_#faf9f7_42%,_#ffffff_100%)]">
      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-ink/20 lg:hidden"
          aria-label="Close navigation"
          onClick={() => onSidebarOpenChange(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border-hairline bg-white transition-transform lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="px-6 pb-2 pt-7">
          <p className="font-serif text-2xl leading-none text-ink">ContOS</p>
          <p className="mt-2 text-xs tracking-wide text-ink-muted">Fractional CMO</p>
        </div>

        <DashboardSidebarNav
          projectId={projectId}
          onNavigate={() => onSidebarOpenChange(false)}
        />

        <div className="px-4 pb-6">
          {atAvatarCap ? (
            <p className="mb-3 text-center text-xs text-ink-muted">
              Project limit reached ({MAX_AVATARS}).
            </p>
          ) : (
            <Link
              to="/projects/new"
              onClick={() => onSidebarOpenChange(false)}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-accent-primary px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(116,79,185,0.28)] transition hover:bg-accent-primary-deep"
            >
              + New Project
            </Link>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopBar
          projects={projects}
          activeProject={activeProject}
          onAvatarsChanged={onAvatarsChanged}
          userEmail={userEmail}
          isSigningOut={isSigningOut}
          onSignOut={onSignOut}
          onOpenSidebar={() => onSidebarOpenChange(true)}
        />
        <main className={`min-h-0 min-w-0 flex-1 ${mainClassName}`}>{children}</main>
      </div>
    </div>
  )
}

export function EmptyProjectsState() {
  return (
    <section className="mx-auto max-w-xl rounded-[2rem] border border-border-hairline bg-white p-10 text-center shadow-[0_18px_40px_rgba(28,27,41,0.06)]">
      <p className="text-sm font-medium uppercase tracking-wide text-accent-primary">Step 01</p>
      <h2 className="mt-3 font-serif text-3xl text-ink">Create your first project</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm text-ink-muted">
        Projects organize the competitors you track and the intelligence ContOS generates for your
        brand or business.
      </p>
      <Link
        to="/projects/new"
        className="mt-8 inline-block rounded-full bg-accent-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-accent-primary-deep"
      >
        New project
      </Link>
    </section>
  )
}
