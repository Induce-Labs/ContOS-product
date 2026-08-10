import { Link, useLocation } from 'react-router-dom'
import type { Project } from '../../lib/projects'
import type { Competitor } from '../../lib/competitors'
import { MAX_COMPETITORS_PER_PROJECT } from '../../lib/competitors'
import { displayCompetitorHandle } from '../../lib/instagram-display'

type DashboardSidebarProps = {
  projects: Project[]
  activeProject: Project | null
  competitors: Competitor[]
  selectedCompetitorId: string | null
  onSelectCompetitor: (competitorId: string) => void
  onAddCompetitor: () => void
  isAddCompetitorOpen: boolean
}

export function DashboardSidebar({
  projects,
  activeProject,
  competitors,
  selectedCompetitorId,
  onSelectCompetitor,
  onAddCompetitor,
  isAddCompetitorOpen,
}: DashboardSidebarProps) {
  const location = useLocation()
  const atCompetitorCap = competitors.length >= MAX_COMPETITORS_PER_PROJECT
  const onAgentsPage =
    !!activeProject && location.pathname === `/dashboard/${activeProject.id}/agents`

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border-hairline bg-canvas-raised sm:w-64 lg:w-72">
      <div className="border-b border-border-hairline p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-accent-primary">Projects</p>
        <nav className="mt-3 space-y-1">
          {projects.map((project) => {
            const isActive = activeProject?.id === project.id

            return (
              <Link
                key={project.id}
                to={`/dashboard/${project.id}`}
                className={`block rounded-xl px-3 py-2 text-sm transition ${
                  isActive
                    ? 'bg-accent-primary-soft font-medium text-accent-primary-deep'
                    : 'text-ink-muted hover:bg-canvas hover:text-ink'
                }`}
              >
                <span className="block truncate">{project.name}</span>
                <span className="mt-0.5 block text-xs capitalize opacity-80">{project.status}</span>
              </Link>
            )
          })}
        </nav>
        <Link
          to="/projects/new"
          className="mt-3 block rounded-xl border border-dashed border-border-hairline px-3 py-2 text-center text-xs font-medium text-accent-primary hover:bg-accent-primary-soft"
        >
          + New project
        </Link>
      </div>

      {activeProject ? (
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-accent-primary">
              Competitors
            </p>
            <span className="text-xs text-ink-muted">
              {competitors.length}/{MAX_COMPETITORS_PER_PROJECT}
            </span>
          </div>

          <Link
            to={`/dashboard/${activeProject.id}/agents`}
            className={`mb-3 block rounded-xl px-3 py-2 text-center text-xs font-medium transition ${
              onAgentsPage
                ? 'bg-accent-primary text-white'
                : 'border border-border-hairline text-accent-primary hover:bg-accent-primary-soft'
            }`}
          >
            Open chat
          </Link>

          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {competitors.length === 0 ? (
              <p className="text-sm text-ink-muted">No competitors yet.</p>
            ) : (
              competitors.map((competitor) => {
                const isSelected = selectedCompetitorId === competitor.id

                return (
                  <button
                    key={competitor.id}
                    type="button"
                    onClick={() => onSelectCompetitor(competitor.id)}
                    className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                      isSelected
                        ? 'bg-accent-primary text-white'
                        : 'text-ink hover:bg-accent-primary-soft'
                    }`}
                  >
                    <span className="block truncate font-medium">
                      {displayCompetitorHandle(competitor.handle_or_url, competitor.platform)}
                    </span>
                    <span
                      className={`mt-0.5 block text-xs capitalize ${
                        isSelected ? 'text-white/80' : 'text-ink-muted'
                      }`}
                    >
                      {competitor.platform === 'linkedin' ? 'LinkedIn · ' : 'Instagram · '}
                      {competitor.pipeline_step === 'done'
                        ? 'Ready'
                        : competitor.pipeline_step === 'failed'
                          ? 'Failed'
                          : 'In progress'}
                    </span>
                  </button>
                )
              })
            )}
          </div>

          <div className="mt-4 border-t border-border-hairline pt-4">
            <button
              type="button"
              onClick={onAddCompetitor}
              disabled={atCompetitorCap}
              title={
                atCompetitorCap
                  ? `Maximum of ${MAX_COMPETITORS_PER_PROJECT} competitors per project`
                  : 'Add another Instagram competitor'
              }
              className="w-full rounded-xl bg-accent-primary px-3 py-2.5 text-sm font-medium text-white transition hover:bg-accent-primary-deep disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAddCompetitorOpen ? 'Adding competitor…' : 'Add competitor'}
            </button>
            {atCompetitorCap ? (
              <p className="mt-2 text-center text-xs text-ink-muted">
                Competitor limit reached ({MAX_COMPETITORS_PER_PROJECT})
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  )
}
