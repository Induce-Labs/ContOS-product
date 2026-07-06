import type { PipelineStep } from '../types/contos'

export const PIPELINE_STEPS: PipelineStep[] = [
  'queued',
  'scraping',
  'transcribing',
  'analyzing',
  'done',
]

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

export function pipelineStepIndex(step: PipelineStep): number {
  if (step === 'failed') {
    return -1
  }

  const index = PIPELINE_STEPS.indexOf(step)
  return index === -1 ? 0 : index
}

export function isPipelineStepComplete(
  currentStep: PipelineStep,
  targetStep: PipelineStep,
): boolean {
  if (currentStep === 'failed') {
    return false
  }

  if (currentStep === 'done') {
    return true
  }

  return pipelineStepIndex(currentStep) > pipelineStepIndex(targetStep)
}

export function isPipelineStepActive(
  currentStep: PipelineStep,
  targetStep: PipelineStep,
): boolean {
  if (currentStep === 'failed' || currentStep === 'done') {
    return false
  }

  return currentStep === targetStep
}
