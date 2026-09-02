import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { OverviewWorkspaceHeader } from '../components/dashboard/OverviewWorkspaceHeader'
import { useDashboardShell } from '../hooks/useDashboardShell'

type PlaceholderFeaturePageProps = {
  title: string
  subtitle: string
}

export function PlaceholderFeaturePage({ title, subtitle }: PlaceholderFeaturePageProps) {
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
      mainClassName="overflow-y-auto px-4 pb-8 sm:px-8"
    >
      <OverviewWorkspaceHeader title={title} subtitle={subtitle} />
      <section className="rounded-[2rem] border border-white/80 bg-white p-8 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-primary">
          Coming soon
        </p>
        <h2 className="mt-3 font-serif text-2xl text-ink">This module is in development</h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
          The {title.toLowerCase()} experience will appear here without changing your existing
          projects, chat, or competitor research.
        </p>
      </section>
    </DashboardLayout>
  )
}

export function CalendarPage() {
  return (
    <PlaceholderFeaturePage
      title="Calendar"
      subtitle="Plan and review content timing for this project."
    />
  )
}

export function InsightsPage() {
  return (
    <PlaceholderFeaturePage
      title="Insights"
      subtitle="Surface strategic takeaways from competitor research and brand context."
    />
  )
}
