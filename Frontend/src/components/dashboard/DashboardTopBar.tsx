import { useTranslation } from 'react-i18next'
import { ProjectSwitcher } from './ProjectSwitcher'
import { LanguageSelector } from '../LanguageSelector'
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
  const { t } = useTranslation()

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenSidebar}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-hairline bg-white text-ink lg:hidden"
          aria-label={t('topBar.openNavigationAria')}
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
        <LanguageSelector id="dashboard-language-select" />
        <span className="hidden max-w-[220px] truncate text-sm text-ink-muted sm:inline">
          {userEmail}
        </span>
        <button
          type="button"
          onClick={onSignOut}
          disabled={isSigningOut}
          className="rounded-full border border-border-hairline bg-white px-4 py-2 text-sm text-ink transition hover:bg-accent-primary-soft disabled:opacity-60"
        >
          {isSigningOut ? t('topBar.signingOut') : t('topBar.signOut')}
        </button>
      </div>
    </header>
  )
}
