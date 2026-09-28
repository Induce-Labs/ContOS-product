import { useTranslation } from 'react-i18next'
import { MAX_COMPETITORS_PER_AVATAR } from '../../lib/competitors'
import { displayCompetitorHandle } from '../../lib/instagram-display'
import type { Competitor } from '../../lib/competitors'
import { PlusIcon } from '../icons/ActionIcons'

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
  const { t } = useTranslation()
  const atCompetitorCap = competitors.length >= MAX_COMPETITORS_PER_AVATAR

  return (
    <section className="min-w-0 rounded-[1.75rem] border border-border-hairline bg-canvas-raised p-4 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-muted">
            {t('competitors.workspacePanel.heading')}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {t('competitors.workspacePanel.tracked', {
              count: competitors.length,
              max: MAX_COMPETITORS_PER_AVATAR,
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={onAddCompetitor}
          disabled={atCompetitorCap}
          title={
            atCompetitorCap
              ? t('onboarding.competitors.maxReached', { max: MAX_COMPETITORS_PER_AVATAR })
              : undefined
          }
          className="contos-btn contos-btn--pill contos-btn--primary"
        >
          <PlusIcon />
          {isAddCompetitorOpen ? t('competitors.addingCompetitor') : t('competitors.addCompetitor')}
        </button>
      </div>

      {competitors.length === 0 ? (
        <p className="text-sm text-ink-muted">{t('dashboard.noCompetitors')}</p>
      ) : (
        <div className="flex min-w-0 flex-wrap gap-2">
          {competitors.map((competitor) => {
            const isSelected = selectedCompetitorId === competitor.id
            const platformLabel =
              competitor.platform === 'linkedin'
                ? t('common.platforms.linkedin')
                : competitor.platform === 'twitter'
                  ? t('common.platforms.twitter')
                  : t('common.platforms.instagram')
            const statusLabel =
              competitor.pipeline_step === 'done'
                ? t('pipeline.status.done')
                : competitor.pipeline_step === 'failed'
                  ? t('pipeline.status.failed')
                  : t('pipeline.status.inProgress')
            const statusDot =
              competitor.pipeline_step === 'done'
                ? 'bg-signal-positive'
                : competitor.pipeline_step === 'failed'
                  ? 'bg-red-500'
                  : 'bg-accent-primary-deep'

            return (
              <button
                key={competitor.id}
                type="button"
                onClick={() => onSelectCompetitor(competitor.id)}
                className={`inline-flex max-w-full min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-left text-sm transition ${
                  isSelected
                    ? 'border-accent-primary bg-accent-primary font-semibold text-btn-primary-fg'
                    : 'border-border-hairline bg-canvas font-medium text-ink hover:border-accent-primary/50'
                }`}
              >
                <span className="min-w-0 truncate">
                  {displayCompetitorHandle(competitor.handle_or_url, competitor.platform)}
                </span>
                <span className={`shrink-0 text-xs ${isSelected ? 'opacity-75' : 'text-ink-muted'}`}>
                  {platformLabel}
                </span>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 text-xs ${
                    isSelected ? 'opacity-75' : 'text-ink-muted'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} aria-hidden="true" />
                  {statusLabel}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {atCompetitorCap ? (
        <p className="mt-3 text-xs text-ink-muted">
          {t('onboarding.competitors.maxReached', { max: MAX_COMPETITORS_PER_AVATAR })}
        </p>
      ) : null}
    </section>
  )
}
