import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WAITING_MESSAGE_I18N_KEYS,
  WAITING_MESSAGE_ROTATE_MS,
  createWaitingMessageRotator,
  nextWaitingMessageIndex,
} from './waitingMessageRotation'

describe('nextWaitingMessageIndex', () => {
  it('advances and wraps', () => {
    expect(nextWaitingMessageIndex(0, 5)).toBe(1)
    expect(nextWaitingMessageIndex(4, 5)).toBe(0)
  })

  it('rejects invalid length or index', () => {
    expect(() => nextWaitingMessageIndex(0, 0)).toThrow(/length/)
    expect(() => nextWaitingMessageIndex(-1, 5)).toThrow(/index/)
  })
})

describe('createWaitingMessageRotator', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('emits 0 immediately and advances on interval', () => {
    vi.useFakeTimers()
    const ticks: number[] = []
    const rotator = createWaitingMessageRotator({
      length: WAITING_MESSAGE_I18N_KEYS.length,
      intervalMs: WAITING_MESSAGE_ROTATE_MS,
    })

    rotator.start((index) => {
      ticks.push(index)
    })

    expect(ticks).toEqual([0])
    vi.advanceTimersByTime(WAITING_MESSAGE_ROTATE_MS)
    expect(ticks).toEqual([0, 1])
    vi.advanceTimersByTime(WAITING_MESSAGE_ROTATE_MS * 4)
    expect(ticks).toEqual([0, 1, 2, 3, 4, 0])
  })

  it('stop clears the interval so no further ticks fire', () => {
    vi.useFakeTimers()
    const ticks: number[] = []
    const rotator = createWaitingMessageRotator({ length: 3, intervalMs: 1000 })

    rotator.start((index) => {
      ticks.push(index)
    })
    rotator.stop()
    vi.advanceTimersByTime(5000)
    expect(ticks).toEqual([0])
  })

  it('start again resets to index 0', () => {
    vi.useFakeTimers()
    const ticks: number[] = []
    const rotator = createWaitingMessageRotator({ length: 3, intervalMs: 1000 })

    rotator.start((index) => {
      ticks.push(index)
    })
    vi.advanceTimersByTime(2000)
    expect(ticks).toEqual([0, 1, 2])

    rotator.start((index) => {
      ticks.push(index)
    })
    expect(ticks).toEqual([0, 1, 2, 0])
    rotator.stop()
  })
})
