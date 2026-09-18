import { useTranslation } from 'react-i18next'
import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { OverviewWorkspaceHeader } from '../components/dashboard/OverviewWorkspaceHeader'
import { useDashboardShell } from '../hooks/useDashboardShell'

type PlaceholderFeaturePageProps = {
  titleKey: string
  subtitleKey: string
}

export function PlaceholderFeaturePage({ titleKey, subtitleKey }: PlaceholderFeaturePageProps) {
  const { t } = useTranslation()
  const title = t(titleKey)
  const subtitle = t(subtitleKey)
  const {
    user,
    projects,
    setProjects,
    activeProject,
    projectsLoading,
    isSigningOut,
    sidebarOpen,
    setSidebarOpen,
    handleSignOut,
  } = useDashboardShell()

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
      isLoading={projectsLoading}
      mainClassName="overflow-y-auto px-4 pb-8 pt-4 sm:px-8 sm:pt-6"
    >
      <OverviewWorkspaceHeader title={title} subtitle={subtitle} />
      <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-primary-deep">
          {t('placeholder.comingSoon')}
        </p>
        <h2 className="mt-3 font-serif text-2xl text-ink">{t('placeholder.inDevelopment')}</h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
          {t('placeholder.body', { title: title.toLowerCase() })}
        </p>
      </section>
    </DashboardLayout>
  )
}

export function CalendarPage() {
  return (
    <PlaceholderFeaturePage
      titleKey="placeholder.calendar.title"
      subtitleKey="placeholder.calendar.subtitle"
    />
  )
}

export function InsightsPage() {
  return (
    <PlaceholderFeaturePage
      titleKey="placeholder.insights.title"
      subtitleKey="placeholder.insights.subtitle"
    />
  )
}
