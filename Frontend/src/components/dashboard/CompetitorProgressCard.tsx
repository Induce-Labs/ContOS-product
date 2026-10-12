import { useTranslation } from 'react-i18next'
import type { Competitor } from '../../lib/competitors'
import type { PipelineStep } from '../../types/contos'
import {
  getPipelineStepsForPlatform,
  isPipelineStepActive,
  isPipelineStepComplete,
} from '../../lib/pipeline'
import { displayCompetitorHandle } from '../../lib/instagram-display'
import { TrashIcon } from '../icons/ActionIcons'

type CompetitorProgressCardProps = {
  competitor: Competitor
  onRetry?: (competitorId: string) => void
  onDelete?: (competitorId: string) => void
  isRetrying?: boolean
  isDeleting?: boolean
}

export function CompetitorProgressCard({
  competitor,
  onRetry,
  onDelete,
  isRetrying = false,
  isDeleting = false,
}: CompetitorProgressCardProps) {
  const { t } = useTranslation()
  const pipelineStep = competitor.pipeline_step as PipelineStep
  const isFailed = pipelineStep === 'failed'
  const canStartOrRetry = isFailed || pipelineStep === 'queued'
  const actionsBusy = isRetrying || isDeleting
  const platform = competitor.platform
  const steps = getPipelineStepsForPlatform(platform)
  const gridClass =
    platform === 'linkedin' || platform === 'twitter'
      ? 'sm:grid-cols-4'
      : 'sm:grid-cols-5'

  return (
    <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-accent-primary-deep">
            {t('competitors.progressCard.eyebrow')}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-ink">
              {displayCompetitorHandle(competitor.handle_or_url, platform)}
            </h2>
            <PlatformBadge platform={platform} />
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {t(`pipeline.descriptions.${pipelineStep}`)}
          </p>
        </div>
        <StatusBadge
          step={pipelineStep}
          scrapeStatus={competitor.scrape_status}
        />
      </div>

      {isFailed && competitor.error_message ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {competitor.error_message}
        </div>
      ) : null}

      {canStartOrRetry || onDelete ? (
        <div className="mt-6 flex flex-wrap gap-3">
          {canStartOrRetry && onRetry ? (
            <button
              type="button"
              onClick={() => onRetry(competitor.id)}
              disabled={actionsBusy}
              className={`contos-btn contos-btn--rect ${
                isFailed ? 'contos-btn--secondary border-red-200 text-red-700 hover:bg-red-50' : 'contos-btn--secondary'
              }`}
            >
              {isRetrying
                ? t('competitors.progressCard.starting')
                : isFailed
                  ? t('competitors.progressCard.retryResearch')
                  : t('competitors.progressCard.startResearch')}
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={() => onDelete(competitor.id)}
              disabled={actionsBusy}
              className="contos-btn contos-btn--rect contos-btn--secondary text-ink-muted hover:border-red-200 hover:bg-red-50 hover:text-red-700"
            >
              <TrashIcon />
              {isDeleting
                ? t('competitors.progressCard.deleting')
                : t('competitors.progressCard.delete')}
            </button>
          ) : null}
        </div>
      ) : null}

      <ol className={`mt-8 grid gap-3 ${gridClass}`}>
        {steps.map((step) => {
          const complete = isPipelineStepComplete(pipelineStep, step, platform)
          const active = isPipelineStepActive(pipelineStep, step, platform)
          const failed = isFailed && active

          return (
            <li
              key={step}
              className={`rounded-2xl border px-3 py-3 text-center ${
                complete
                  ? 'border-signal-positive/30 bg-signal-positive-soft'
                  : active
                    ? 'border-accent-primary bg-accent-primary-soft'
                    : failed
                      ? 'border-red-200 bg-red-50'
                      : 'border-border-hairline bg-canvas'
              }`}
            >
              <p
                className={`text-xs font-medium uppercase tracking-wide ${
                  complete
                    ? 'text-signal-positive'
                    : active
                      ? 'text-accent-primary-deep'
                      : failed
                        ? 'text-red-700'
                        : 'text-ink-muted'
                }`}
              >
                {t(`pipeline.labels.${step}`)}
              </p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function PlatformBadge({ platform }: { platform: string }) {
  const { t } = useTranslation()
  const label =
    platform === 'linkedin'
      ? t('common.platforms.linkedin')
      : platform === 'twitter'
        ? t('common.platforms.twitter')
        : t('common.platforms.instagram')
  return (
    <span className="rounded-full border border-border-hairline px-2 py-0.5 text-xs capitalize text-ink-muted">
      {label}
    </span>
  )
}

type StatusBadgeProps = {
  step: PipelineStep
  scrapeStatus: string
}

function StatusBadge({ step, scrapeStatus }: StatusBadgeProps) {
  const { t } = useTranslation()

  if (step === 'failed') {
    return (
      <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
        {t('pipeline.status.failed')}
      </span>
    )
  }

  if (step === 'done' || scrapeStatus === 'completed') {
    return (
      <span className="rounded-full bg-signal-positive-soft px-3 py-1 text-xs font-medium text-signal-positive">
        {t('pipeline.status.done')}
      </span>
    )
  }

  return (
    <span className="rounded-full bg-accent-primary-soft px-3 py-1 text-xs font-medium text-accent-primary-deep">
      {t('pipeline.status.inProgress')}
    </span>
  )
}
