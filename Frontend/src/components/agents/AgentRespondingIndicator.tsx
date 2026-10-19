import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  WAITING_MESSAGE_FADE_MS,
  WAITING_MESSAGE_I18N_KEYS,
  WAITING_MESSAGE_ROTATE_MS,
  createWaitingMessageRotator,
  prefersReducedMotion,
} from '../../lib/waitingMessageRotation'

type AgentRespondingIndicatorProps = {
  active: boolean
  markSrc: string
  markDarkSrc: string
  ariaLabel: string
}

/**
 * Pulsing ContOS mark + rotating waiting copy shown until the first assistant
 * content arrives. Timers stop when `active` becomes false or on unmount.
 */
export function AgentRespondingIndicator({
  active,
  markSrc,
  markDarkSrc,
  ariaLabel,
}: AgentRespondingIndicatorProps) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  const [fadeIn, setFadeIn] = useState(true)

  useEffect(() => {
    if (!active) {
      setIndex(0)
      setFadeIn(true)
      return
    }

    if (prefersReducedMotion()) {
      setIndex(0)
      setFadeIn(true)
      return
    }

    let fadeTimer: ReturnType<typeof setTimeout> | null = null
    let isFirstTick = true
    const rotator = createWaitingMessageRotator({
      length: WAITING_MESSAGE_I18N_KEYS.length,
      intervalMs: WAITING_MESSAGE_ROTATE_MS,
    })

    rotator.start((nextIndex) => {
      if (isFirstTick) {
        isFirstTick = false
        setIndex(nextIndex)
        setFadeIn(true)
        return
      }
      setFadeIn(false)
      if (fadeTimer != null) {
        clearTimeout(fadeTimer)
      }
      fadeTimer = setTimeout(() => {
        setIndex(nextIndex)
        setFadeIn(true)
        fadeTimer = null
      }, WAITING_MESSAGE_FADE_MS)
    })

    return () => {
      rotator.stop()
      if (fadeTimer != null) {
        clearTimeout(fadeTimer)
      }
    }
  }, [active])

  const messageKey = WAITING_MESSAGE_I18N_KEYS[index] ?? WAITING_MESSAGE_I18N_KEYS[0]

  return (
    <div
      className="flex items-center gap-2.5 px-4 py-0.5 sm:px-8"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas-raised shadow-[0_2px_8px_rgba(28,27,41,0.06)] ring-1 ring-border-hairline">
        <img
          src={markSrc}
          alt=""
          aria-hidden="true"
          className="contos-mark-loading h-5 w-5 object-contain dark:hidden"
        />
        <img
          src={markDarkSrc}
          alt=""
          aria-hidden="true"
          className="contos-mark-loading hidden h-5 w-5 object-contain dark:block"
        />
      </span>
      <span
        className={`agent-waiting-message min-h-5 min-w-0 flex-1 truncate text-sm leading-5 text-ink-muted ${
          fadeIn ? 'agent-waiting-message--in' : 'agent-waiting-message--out'
        }`}
      >
        {t(messageKey)}
      </span>
    </div>
  )
}
