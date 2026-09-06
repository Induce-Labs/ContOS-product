import type { PipelineStep } from '../types/contos'

export const INSTAGRAM_PIPELINE_STEPS: PipelineStep[] = [
  'queued',
  'scraping',
  'transcribing',
  'analyzing',
  'done',
]

export const LINKEDIN_PIPELINE_STEPS: PipelineStep[] = [
  'queued',
  'scraping',
  'analyzing',
  'done',
]

/** @deprecated Prefer platform-aware helpers; kept for Instagram default. */
export const PIPELINE_STEPS = INSTAGRAM_PIPELINE_STEPS

/** i18n key suffixes under `pipeline.labels.*` / `pipeline.descriptions.*`. */
export const PIPELINE_STEP_I18N_KEYS: Record<PipelineStep, string> = {
  queued: 'queued',
  scraping: 'scraping',
  transcribing: 'transcribing',
  analyzing: 'analyzing',
  done: 'done',
  failed: 'failed',
}

/** English fallbacks for non-React callers; UI should use `t('pipeline.labels.*')`. */
export const PIPELINE_STEP_LABELS: Record<PipelineStep, string> = {
  queued: 'Queued',
  scraping: 'Researching competitors',
  transcribing: 'Transcribing reels',
  analyzing: 'Analyzing content',
  done: 'Done',
  failed: 'Failed',
}

export const PIPELINE_STEP_DESCRIPTIONS: Record<PipelineStep, string> = {
  queued: 'Waiting to start research…',
  scraping: 'Researching your competitors…',
  transcribing: 'Transcribing reel audio…',
  analyzing: 'Analyzing top content…',
  done: 'Intelligence report ready',
  failed: 'Something went wrong during research',
}

export function getPipelineStepsForPlatform(platform?: string): PipelineStep[] {
  return platform === 'linkedin' ? LINKEDIN_PIPELINE_STEPS : INSTAGRAM_PIPELINE_STEPS
}

export function pipelineStepIndex(step: PipelineStep, platform?: string): number {
  if (step === 'failed') {
    return -1
  }

  const steps = getPipelineStepsForPlatform(platform)
  const index = steps.indexOf(step)
  return index === -1 ? 0 : index
}

export function isPipelineStepComplete(
  currentStep: PipelineStep,
  targetStep: PipelineStep,
  platform?: string,
): boolean {
  if (currentStep === 'failed') {
    return false
  }

  if (currentStep === 'done') {
    return true
  }

  // LinkedIn never uses transcribing; treat it as already passed when further along.
  if (platform === 'linkedin' && targetStep === 'transcribing') {
    return currentStep === 'analyzing' || currentStep === 'scraping'
  }

  return pipelineStepIndex(currentStep, platform) > pipelineStepIndex(targetStep, platform)
}

export function isPipelineStepActive(
  currentStep: PipelineStep,
  targetStep: PipelineStep,
  platform?: string,
): boolean {
  if (currentStep === 'failed' || currentStep === 'done') {
    return false
  }

  if (platform === 'linkedin' && targetStep === 'transcribing') {
    return false
  }

  return currentStep === targetStep
}
