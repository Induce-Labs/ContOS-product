import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { DashboardSidebarNav } from './DashboardSidebarNav'
import { DashboardTopBar } from './DashboardTopBar'
import { ProjectSwitcher } from './ProjectSwitcher'
import { SidebarUserMenu } from './SidebarUserMenu'
import contosMark from '../../assets/contos-mark.png'
import contosMarkDark from '../../assets/image.png'
import type { Project } from '../../lib/projects'
import type { ReactNode } from 'react'

const SIDEBAR_COLLAPSED_KEY = 'contos_sidebar_collapsed'

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

function readCollapsedPreference() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function SidebarCollapseIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className="h-5 w-5"
      aria-hidden
    >
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9 4.5v15" strokeLinecap="round" />
      {expanded ? (
        <path d="M15.5 9.5 13 12l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M13 9.5 15.5 12 13 14.5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
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
  const { t } = useTranslation()
  const projectId = activeProject?.id ?? null
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readCollapsedPreference)
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true,
  )
  const railCollapsed = sidebarCollapsed && isDesktop

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)')
    function syncDesktop(event?: MediaQueryListEvent) {
      setIsDesktop(event ? event.matches : media.matches)
    }
    syncDesktop()
    media.addEventListener('change', syncDesktop)
    return () => media.removeEventListener('change', syncDesktop)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0')
    } catch {
      // Preference persistence is best-effort; layout still works without it.
    }
  }, [sidebarCollapsed])

  useEffect(() => {
    const html = document.documentElement
    const body = document.body
    const previousHtmlOverflow = html.style.overflow
    const previousBodyOverflow = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      html.style.overflow = previousHtmlOverflow
      body.style.overflow = previousBodyOverflow
    }
  }, [])

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas font-sans text-ink-muted">
        {t('layout.loadingWorkspace')}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 flex h-dvh max-h-dvh w-full overflow-hidden overscroll-none bg-canvas font-sans">
      {sidebarOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-ink/20 lg:hidden"
          aria-label={t('layout.closeNavigationAria')}
          onClick={() => onSidebarOpenChange(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex h-full max-h-full min-h-0 flex-col border-r border-border-hairline bg-[linear-gradient(180deg,#fafafc_0%,#f5f2fd_45%,#f8f1fd_72%,#fcf3fb_100%)] transition-[width,transform] duration-200 dark:bg-canvas-raised dark:bg-none lg:static lg:translate-x-0 ${
          railCollapsed ? 'w-[72px]' : 'w-[260px]'
        } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        <div
          className={
            railCollapsed
              ? 'flex w-full flex-col items-center gap-2 px-0 pb-2 pt-5'
              : 'flex items-start justify-between gap-2 px-4 pb-3 pt-5'
          }
        >
          <div
            className={`flex min-w-0 items-center ${
              railCollapsed ? 'w-full justify-center' : 'gap-2.5'
            }`}
          >
            <img
              src={contosMark}
              alt=""
              aria-hidden="true"
              className="h-8 w-8 shrink-0 object-contain dark:hidden"
            />
            <img
              src={contosMarkDark}
              alt=""
              aria-hidden="true"
              className="hidden h-8 w-8 shrink-0 object-contain dark:block"
            />
            {!railCollapsed ? (
              <div className="min-w-0">
                <p className="truncate text-base font-semibold leading-tight text-ink">
                  {t('layout.brandName')}
                </p>
                <p className="truncate text-[11px] tracking-wide text-ink-muted">
                  {t('layout.brandTagline')}
                </p>
              </div>
            ) : null}
          </div>

          <div
            className={`flex shrink-0 items-center justify-center gap-1 ${
              railCollapsed ? 'w-full' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => setSidebarCollapsed((current) => !current)}
              className="hidden h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition hover:bg-canvas hover:text-ink lg:inline-flex"
              aria-label={
                sidebarCollapsed
                  ? t('layout.expandSidebarAria')
                  : t('layout.collapseSidebarAria')
              }
              title={
                sidebarCollapsed
                  ? t('layout.expandSidebarAria')
                  : t('layout.collapseSidebarAria')
              }
            >
              <SidebarCollapseIcon expanded={!sidebarCollapsed} />
            </button>

            <button
              type="button"
              onClick={() => onSidebarOpenChange(false)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition hover:bg-canvas hover:text-ink lg:hidden"
              aria-label={t('layout.closeNavigationAria')}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                className="h-4 w-4"
                aria-hidden
              >
                <path d="M4 6h10M4 12h16M4 18h10" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        <div
          className={
            railCollapsed
              ? 'flex w-full justify-center px-0 pb-1 pt-3'
              : 'px-3 pb-3'
          }
        >
          <ProjectSwitcher
            projects={projects}
            activeProject={activeProject}
            onAvatarsChanged={onAvatarsChanged}
            collapsed={railCollapsed}
          />
        </div>

        <DashboardSidebarNav
          projectId={projectId}
          onNavigate={() => onSidebarOpenChange(false)}
          collapsed={railCollapsed}
        />

        <div
          className={`mt-auto ${railCollapsed ? 'flex w-full justify-center py-3' : ''}`}
        >
          <SidebarUserMenu
            userEmail={userEmail}
            isSigningOut={isSigningOut}
            onSignOut={onSignOut}
            collapsed={railCollapsed}
          />
        </div>
      </aside>

      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white dark:bg-canvas">
        <DashboardTopBar onOpenSidebar={() => onSidebarOpenChange(true)} />
        <main className={`min-h-0 min-w-0 flex-1 ${mainClassName}`}>{children}</main>
      </div>
    </div>
  )
}

export function EmptyProjectsState() {
  const { t } = useTranslation()
  return (
    <section className="mx-auto max-w-xl rounded-[2rem] border border-border-hairline bg-canvas-raised p-10 text-center font-sans shadow-[0_18px_40px_rgba(28,27,41,0.06)]">
      <p className="text-sm font-medium uppercase tracking-wide text-accent-primary-deep">
        {t('layout.emptyProjects.step')}
      </p>
      <h2 className="mt-3 font-serif text-3xl text-ink">{t('layout.emptyProjects.title')}</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm text-ink-muted">
        {t('layout.emptyProjects.body')}
      </p>
      <Link
        to="/projects/new"
        className="contos-btn contos-btn--pill contos-btn--primary mt-8"
      >
        {t('layout.emptyProjects.cta')}
      </Link>
    </section>
  )
}
