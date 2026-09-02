import { ProjectSwitcher } from './ProjectSwitcher'
import type { Project } from '../../lib/projects'

type DashboardTopBarProps = {
  projects: Project[]
  activeProject: Project | null
  onAvatarsChanged: (projects: Project[]) => void
  userEmail?: string | null
  isSigningOut: boolean
  onSignOut: () => void
  onOpenSidebar: () => void
}

export function DashboardTopBar({
  projects,
  activeProject,
  onAvatarsChanged,
  userEmail,
  isSigningOut,
  onSignOut,
  onOpenSidebar,
}: DashboardTopBarProps) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-hairline bg-white text-ink lg:hidden"
          aria-label="Open navigation"
        >
          ☰
        </button>
        <ProjectSwitcher
          projects={projects}
          activeProject={activeProject}
          onAvatarsChanged={onAvatarsChanged}
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden max-w-[220px] truncate text-sm text-ink-muted sm:inline">
          {userEmail}
        </span>
        <button
          type="button"
          onClick={onSignOut}
          disabled={isSigningOut}
          className="rounded-full border border-border-hairline bg-white px-4 py-2 text-sm text-ink transition hover:bg-accent-primary-soft disabled:opacity-60"
        >
          {isSigningOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </header>
  )
}
