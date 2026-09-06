import { useTranslation } from 'react-i18next'
import type { Competitor } from '../../lib/competitors'
import type { PipelineStep } from '../../types/contos'
import {
  getPipelineStepsForPlatform,
  isPipelineStepActive,
  isPipelineStepComplete,
} from '../../lib/pipeline'
import { displayCompetitorHandle } from '../../lib/instagram-display'

type CompetitorProgressCardProps = {
  competitor: Competitor
  onRetry?: (competitorId: string) => void
  onStop?: (competitorId: string) => void
  isRetrying?: boolean
  isStopping?: boolean
}

export function CompetitorProgressCard({
  competitor,
  onRetry,
  onStop,
  isRetrying = false,
  isStopping = false,
}: CompetitorProgressCardProps) {
  const { t } = useTranslation()
  const pipelineStep = competitor.pipeline_step as PipelineStep
  const isFailed = pipelineStep === 'failed'
  const canStartOrRetry = isFailed || pipelineStep === 'queued'
  const isInProgress =
    pipelineStep === 'scraping' ||
    pipelineStep === 'transcribing' ||
    pipelineStep === 'analyzing'
  const stopRequested = Boolean(competitor.cancel_requested)
  const canStop = isInProgress && !stopRequested && !!onStop
  const platform = competitor.platform
  const steps = getPipelineStepsForPlatform(platform)
  const gridClass =
    platform === 'linkedin' ? 'sm:grid-cols-4' : 'sm:grid-cols-5'

  return (
    <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-accent-primary">
            {t('competitors.progressCard.eyebrow')}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-ink">
              {displayCompetitorHandle(competitor.handle_or_url, platform)}
            </h2>
            <PlatformBadge platform={platform} />
          </div>
          <p className="mt-2 text-sm text-ink-muted">
            {stopRequested
              ? t('competitors.progressCard.stoppingHint')
              : t(`pipeline.descriptions.${pipelineStep}`)}
          </p>
        </div>
        <StatusBadge
          step={pipelineStep}
          scrapeStatus={competitor.scrape_status}
          stopRequested={stopRequested}
        />
      </div>

      {isFailed && competitor.error_message ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {competitor.error_message}
        </div>
      ) : null}

      {canStartOrRetry && onRetry ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => onRetry(competitor.id)}
            disabled={isRetrying}
            className={`rounded-xl border px-4 py-2 text-sm font-medium transition disabled:opacity-60 ${
              isFailed
                ? 'border-red-200 bg-white text-red-700 hover:bg-red-50'
                : 'border-border-hairline bg-white text-ink hover:bg-accent-primary-soft'
            }`}
          >
            {isRetrying
              ? t('competitors.progressCard.starting')
              : isFailed
                ? t('competitors.progressCard.retryResearch')
                : t('competitors.progressCard.startResearch')}
          </button>
        </div>
      ) : null}

      {canStop || stopRequested ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => onStop?.(competitor.id)}
            disabled={stopRequested || isStopping || !canStop}
            className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {stopRequested || isStopping
              ? t('competitors.progressCard.stopping')
              : t('competitors.progressCard.stop')}
          </button>
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
  stopRequested: boolean
}

function StatusBadge({ step, scrapeStatus, stopRequested }: StatusBadgeProps) {
  const { t } = useTranslation()

  if (stopRequested && step !== 'done' && step !== 'failed') {
    return (
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
        {t('pipeline.status.stopping')}
      </span>
    )
  }

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
