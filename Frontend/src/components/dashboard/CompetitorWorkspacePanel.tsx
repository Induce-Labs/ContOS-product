import { MAX_COMPETITORS_PER_AVATAR } from '../../lib/competitors'
import { displayCompetitorHandle } from '../../lib/instagram-display'
import type { Competitor } from '../../lib/competitors'

type CompetitorWorkspacePanelProps = {
  competitors: Competitor[]
  selectedCompetitorId: string | null
  onSelectCompetitor: (competitorId: string) => void
  onAddCompetitor: () => void
  isAddCompetitorOpen: boolean
}

export function CompetitorWorkspacePanel({
  competitors,
  selectedCompetitorId,
  onSelectCompetitor,
  onAddCompetitor,
  isAddCompetitorOpen,
}: CompetitorWorkspacePanelProps) {
  const atCompetitorCap = competitors.length >= MAX_COMPETITORS_PER_AVATAR

  return (
    <section className="rounded-[1.75rem] border border-white/80 bg-white/90 p-4 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
            Competitors
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {competitors.length}/{MAX_COMPETITORS_PER_AVATAR} tracked
          </p>
        </div>
        <button
          type="button"
          onClick={onAddCompetitor}
          disabled={atCompetitorCap}
          title={
            atCompetitorCap
              ? `Maximum of ${MAX_COMPETITORS_PER_AVATAR} competitors per avatar`
              : 'Add another competitor'
          }
          className="rounded-full bg-accent-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-primary-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isAddCompetitorOpen ? 'Adding competitor…' : 'Add competitor'}
        </button>
      </div>

      {competitors.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No competitors in this project yet. Use Add competitor to start research.
        </p>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {competitors.map((competitor) => {
            const isSelected = selectedCompetitorId === competitor.id

            return (
              <button
                key={competitor.id}
                type="button"
                onClick={() => onSelectCompetitor(competitor.id)}
                className={`shrink-0 rounded-full px-4 py-2 text-left text-sm transition ${
                  isSelected
                    ? 'bg-accent-primary text-white'
                    : 'border border-border-hairline bg-white text-ink hover:bg-accent-primary-soft'
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
          })}
        </div>
      )}

      {atCompetitorCap ? (
        <p className="mt-3 text-xs text-ink-muted">
          Competitor limit reached ({MAX_COMPETITORS_PER_AVATAR})
        </p>
      ) : null}
    </section>
  )
}
