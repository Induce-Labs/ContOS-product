import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { OverviewWorkspaceHeader } from '../components/dashboard/OverviewWorkspaceHeader'
import { CompetitorSummaryCard } from '../components/dashboard/CompetitorSummaryCard'
import { useDashboardPolling } from '../hooks/useDashboardPolling'
import { useDashboardShell } from '../hooks/useDashboardShell'

export function AnalyticsPage() {
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

  const { competitors, summariesByCompetitorId, isLoading, errorMessage } = useDashboardPolling(
    activeProject?.id ?? null,
  )

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
      <OverviewWorkspaceHeader
        title="Analytics"
        subtitle="Competitor intelligence summaries generated from completed research."
      />

      {projectsError || errorMessage ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {projectsError || errorMessage}
        </div>
      ) : null}

      {competitors.length === 0 ? (
        <section className="rounded-[2rem] border border-dashed border-border-hairline bg-white/80 p-8 text-center">
          <p className="text-sm text-ink-muted">
            No competitor analytics yet. Add competitors from Overview and wait for research to
            finish.
          </p>
        </section>
      ) : (
        <div className="space-y-8">
          {competitors.map((competitor) => {
            const summary = summariesByCompetitorId.get(competitor.id)
            if (!summary) {
              return (
                <section
                  key={competitor.id}
                  className="rounded-[2rem] border border-border-hairline bg-white p-6"
                >
                  <p className="text-sm font-medium text-ink">{competitor.handle_or_url}</p>
                  <p className="mt-2 text-sm text-ink-muted">
                    Summary is not available yet for this competitor.
                  </p>
                </section>
              )
            }

            return (
              <CompetitorSummaryCard
                key={competitor.id}
                competitor={competitor}
                summaryRecord={summary}
              />
            )
          })}
        </div>
      )}
    </DashboardLayout>
  )
}
