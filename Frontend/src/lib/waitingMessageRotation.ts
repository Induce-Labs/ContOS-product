/** Interval between waiting-message swaps while the agent is generating. */
export const WAITING_MESSAGE_ROTATE_MS = 2500

/** Fade duration for waiting-message crossfade (keep in sync with CSS). */
export const WAITING_MESSAGE_FADE_MS = 280

export const WAITING_MESSAGE_I18N_KEYS = [
  'agents.waitingMessages.oneMoment',
  'agents.waitingMessages.workingOnThat',
  'agents.waitingMessages.findingAngle',
  'agents.waitingMessages.puttingTogether',
  'agents.waitingMessages.almostReady',
] as const

export function nextWaitingMessageIndex(current: number, length: number): number {
  if (length <= 0) {
    throw new Error(`waiting message length must be > 0, got ${length}`)
  }
  if (!Number.isInteger(current) || current < 0) {
    throw new Error(`waiting message index must be a non-negative integer, got ${current}`)
  }
  return (current + 1) % length
}

export type WaitingMessageRotator = {
  start: (onTick: (index: number) => void) => void
  stop: () => void
}

/**
 * Advances a waiting-message index on an interval. Cleared by stop() or when
 * start() is called again. Used by the responding indicator; tested without React.
 */
export function createWaitingMessageRotator(options: {
  length: number
  intervalMs?: number
  schedule?: typeof setInterval
  clear?: typeof clearInterval
}): WaitingMessageRotator {
  const length = options.length
  if (length <= 0) {
    throw new Error(`waiting message length must be > 0, got ${length}`)
  }
  const intervalMs = options.intervalMs ?? WAITING_MESSAGE_ROTATE_MS
  const schedule = options.schedule ?? setInterval
  const clear = options.clear ?? clearInterval

  let timer: ReturnType<typeof setInterval> | null = null
  let index = 0

  return {
    start(onTick) {
      if (timer != null) {
        clear(timer)
        timer = null
      }
      index = 0
      onTick(index)
      timer = schedule(() => {
        index = nextWaitingMessageIndex(index, length)
        onTick(index)
      }, intervalMs)
    },
    stop() {
      if (timer != null) {
        clear(timer)
        timer = null
      }
      index = 0
    },
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
