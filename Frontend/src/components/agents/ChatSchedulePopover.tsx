import { useEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { browserTimeZone } from '../../lib/consistency'
import {
  defaultScheduleLocalDateTime,
  formatScheduleHeader,
  type ChatDraftPlatform,
} from '../../lib/chatDraftPrefill'
import {
  PostizApiError,
  createPostizPost,
  getPostizStatus,
  localDateTimeToOffsetIso,
  nowAsOffsetIso,
  startPostizConnect,
  type PostizMediaItem,
  type PostizPostType,
} from '../../lib/postiz'
import { userFacingMessage } from '../../lib/devLog'

const POPUP_NAME_LINKEDIN = 'contos-postiz-oauth'
const POPUP_NAME_X = 'contos-postiz-oauth-x'
const POLL_INTERVAL_MS = 1500
const POLL_TIMEOUT_MS = 120_000

type ChatSchedulePopoverProps = {
  open: boolean
  onClose: () => void
  avatarId: string
  platform: ChatDraftPlatform
  content: string
  images: PostizMediaItem[]
  onSuccess: (type: Exclude<PostizPostType, 'update'>) => void
  anchorRef?: RefObject<HTMLElement | null>
}

export function ChatSchedulePopover({
  open,
  onClose,
  avatarId,
  platform,
  content,
  images,
  onSuccess,
  anchorRef,
}: ChatSchedulePopoverProps) {
  const { t, i18n } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const [when, setWhen] = useState(() => defaultScheduleLocalDateTime())
  const [connected, setConnected] = useState<boolean | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const popupRef = useRef<Window | null>(null)

  const postizPlatform = platform === 'x' ? 'x' : 'linkedin'

  function stopPolling() {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }

  function closePopup() {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close()
    }
    popupRef.current = null
  }

  useEffect(() => {
    if (!open) {
      stopPolling()
      closePopup()
      setPanelPos(null)
      return
    }
    setWhen(defaultScheduleLocalDateTime())
    setError(null)
    setConnected(null)

    function placePanel() {
      const anchor = anchorRef?.current
      if (!anchor) {
        setPanelPos({ top: 80, left: Math.max(16, window.innerWidth - 320) })
        return
      }
      const rect = anchor.getBoundingClientRect()
      const width = 288
      const left = Math.min(
        Math.max(16, rect.right - width),
        window.innerWidth - width - 16,
      )
      const estimatedHeight = 420
      const top =
        rect.top - estimatedHeight - 8 > 16
          ? rect.top - estimatedHeight - 8
          : Math.min(rect.bottom + 8, window.innerHeight - estimatedHeight - 16)
      setPanelPos({ top, left })
    }
    placePanel()
    window.addEventListener('resize', placePanel)
    window.addEventListener('scroll', placePanel, true)

    let cancelled = false
    void (async () => {
      try {
        const status = await getPostizStatus(avatarId, postizPlatform)
        if (!cancelled) {
          setConnected(Boolean(status.connected && status.integration))
        }
      } catch (err) {
        if (!cancelled) {
          setConnected(false)
          setError(userFacingMessage(err, t('postiz.calendar.statusFailed')))
        }
      }
    })()
    return () => {
      cancelled = true
      stopPolling()
      closePopup()
      window.removeEventListener('resize', placePanel)
      window.removeEventListener('scroll', placePanel, true)
    }
  }, [open, avatarId, postizPlatform, t, anchorRef])

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(event: MouseEvent) {
      const target = event.target as Node
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose()
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  async function refreshConnected(): Promise<boolean> {
    const status = await getPostizStatus(avatarId, postizPlatform)
    const ok = Boolean(status.connected && status.integration)
    setConnected(ok)
    return ok
  }

  function startPolling() {
    stopPolling()
    const deadline = Date.now() + POLL_TIMEOUT_MS
    pollTimerRef.current = window.setInterval(() => {
      void (async () => {
        if (Date.now() > deadline) {
          setConnecting(false)
          stopPolling()
          closePopup()
          setError(t('postiz.calendar.timeout'))
          return
        }
        try {
          const ok = await refreshConnected()
          if (ok) {
            setConnecting(false)
            stopPolling()
            closePopup()
            setError(null)
          }
        } catch {
          // Keep polling until timeout.
        }
      })()
    }, POLL_INTERVAL_MS)
  }

  async function handleConnect() {
    setError(null)
    setConnecting(true)
    const popupName = platform === 'x' ? POPUP_NAME_X : POPUP_NAME_LINKEDIN
    const popup = window.open('about:blank', popupName, 'width=640,height=720')
    popupRef.current = popup
    if (!popup) {
      setConnecting(false)
      setError(t('postiz.calendar.popupBlocked'))
      return
    }
    try {
      const result = await startPostizConnect(avatarId, postizPlatform)
      popup.location.href = result.authorization_url
      startPolling()
    } catch (err) {
      setConnecting(false)
      popup.close()
      popupRef.current = null
      setError(userFacingMessage(err, t('postiz.calendar.connectFailed')))
    }
  }

  async function submit(type: 'schedule' | 'now') {
    if (!content.trim()) {
      setError(t('agents.draftComposer.contentRequired'))
      return
    }
    if (connected === false) {
      setError(t('agents.draftComposer.connectBeforeSchedule'))
      return
    }
    if (type === 'schedule' && !when.trim()) {
      setError(t('agents.draftComposer.whenRequired'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      const publishDate =
        type === 'now' ? nowAsOffsetIso() : localDateTimeToOffsetIso(when)
      await createPostizPost({
        avatarId,
        type,
        content: content.trim(),
        publishDate,
        images,
        ...(platform === 'x'
          ? { platform: 'x' as const, posts: [{ content: content.trim() }] }
          : {}),
      })
      onSuccess(type)
      onClose()
    } catch (err) {
      setError(
        userFacingMessage(
          err instanceof PostizApiError ? err : err,
          t('postiz.calendar.saveFailed'),
        ),
      )
    } finally {
      setSaving(false)
    }
  }

  if (!open || !panelPos) return null

  const datePart = when.slice(0, 10)
  const timePart = when.slice(11, 16) || '12:00'

  return (
    <div
      ref={panelRef}
      className="fixed z-50 w-[min(100vw-2rem,18rem)] rounded-2xl border border-border-hairline bg-canvas-raised p-3 shadow-[0_12px_40px_rgba(28,27,41,0.18)]"
      style={{ top: panelPos.top, left: panelPos.left }}
      role="dialog"
      aria-label={t('agents.draftComposer.schedule')}
    >
      <p className="text-sm font-semibold text-ink">
        {formatScheduleHeader(when, i18n.language)}
      </p>

      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {t('agents.draftComposer.date')}
        <input
          type="date"
          className="mt-1 w-full rounded-lg border border-border-hairline bg-canvas px-2.5 py-1.5 text-sm text-ink"
          value={datePart}
          onChange={(event) => setWhen(`${event.target.value}T${timePart}`)}
        />
      </label>

      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        {t('agents.draftComposer.time')}
        <input
          type="time"
          className="mt-1 w-full rounded-lg border border-border-hairline bg-canvas px-2.5 py-1.5 text-sm text-ink"
          value={timePart}
          onChange={(event) => setWhen(`${datePart}T${event.target.value}`)}
        />
      </label>

      {connected === false ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
          <p>{t('agents.draftComposer.connectBeforeSchedule')}</p>
          <button
            type="button"
            className="contos-btn contos-btn--secondary contos-btn--rect mt-2 w-full px-4 py-2.5 text-xs"
            disabled={connecting}
            onClick={() => void handleConnect()}
          >
            {connecting
              ? t('agents.draftComposer.connecting')
              : platform === 'x'
                ? t('postiz.calendar.x.connect')
                : t('postiz.calendar.connectLinkedIn')}
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      <button
        type="button"
        className="contos-btn contos-btn--primary contos-btn--rect mt-3 w-full px-4 py-2.5 text-sm"
        disabled={saving || connected === false || connected === null}
        onClick={() => void submit('schedule')}
      >
        {t('agents.draftComposer.schedulePost')}
      </button>
      <button
        type="button"
        className="contos-btn contos-btn--secondary contos-btn--rect mt-2 w-full px-4 py-2.5 text-sm"
        disabled={saving || connected === false || connected === null}
        onClick={() => void submit('now')}
      >
        {t('agents.draftComposer.publishNow')}
      </button>

      <p className="mt-3 text-[11px] text-ink-muted">
        {t('agents.draftComposer.timezoneShown', { zone: browserTimeZone() })}
      </p>
      <Link
        to={`/dashboard/${encodeURIComponent(avatarId)}/calendar`}
        className="mt-1 inline-block text-[11px] font-medium text-accent-primary"
        onClick={onClose}
      >
        {t('agents.draftComposer.viewCalendar')}
      </Link>
    </div>
  )
}
