import type { Competitor } from '../../lib/competitors'
import type { PipelineStep } from '../../types/contos'
import {
  PIPELINE_STEP_DESCRIPTIONS,
  PIPELINE_STEP_LABELS,
  PIPELINE_STEPS,
  isPipelineStepActive,
  isPipelineStepComplete,
} from '../../lib/pipeline'
import { displayCompetitorHandle } from '../../lib/instagram-display'

type CompetitorProgressCardProps = {
  competitor: Competitor
}

export function CompetitorProgressCard({ competitor }: CompetitorProgressCardProps) {
  const pipelineStep = competitor.pipeline_step as PipelineStep
  const isFailed = pipelineStep === 'failed'

  return (
    <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-accent-primary">
            Research in progress
          </p>
          <h2 className="mt-1 text-xl font-semibold text-ink">
            {displayCompetitorHandle(competitor.handle_or_url)}
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            {PIPELINE_STEP_DESCRIPTIONS[pipelineStep]}
          </p>
        </div>
        <StatusBadge step={pipelineStep} scrapeStatus={competitor.scrape_status} />
      </div>

      {isFailed && competitor.error_message ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {competitor.error_message}
        </div>
      ) : null}

      <ol className="mt-8 grid gap-3 sm:grid-cols-5">
        {PIPELINE_STEPS.map((step) => {
          const complete = isPipelineStepComplete(pipelineStep, step)
          const active = isPipelineStepActive(pipelineStep, step)
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
                {PIPELINE_STEP_LABELS[step]}
              </p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

type StatusBadgeProps = {
  step: PipelineStep
  scrapeStatus: string
}

function StatusBadge({ step, scrapeStatus }: StatusBadgeProps) {
  if (step === 'failed') {
    return (
      <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
        Failed
      </span>
    )
  }

  if (step === 'done' || scrapeStatus === 'completed') {
    return (
      <span className="rounded-full bg-signal-positive-soft px-3 py-1 text-xs font-medium text-signal-positive">
        Done
      </span>
    )
  }

  return (
    <span className="rounded-full bg-accent-primary-soft px-3 py-1 text-xs font-medium text-accent-primary-deep">
      In progress
    </span>
  )
}
