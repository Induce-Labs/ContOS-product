import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { useDashboardShell } from '../hooks/useDashboardShell'
import { userFacingMessage } from '../lib/devLog'
import {
  changePostizPostStatus,
  claimPostizIntegration,
  createPostizPost,
  deletePostizPost,
  disconnectPostizIntegration,
  getPostizStatus,
  isoToLocalDateTimeInput,
  listPostizPosts,
  localDateTimeToOffsetIso,
  nowAsOffsetIso,
  POSTIZ_MAX_POST_IMAGES,
  POSTIZ_MAX_X_POST_IMAGES,
  PostizApiError,
  postizContentLength,
  startPostizConnect,
  type PostizPlatform,
  uploadPostizMedia,
  type PostizCalendarPost,
  type PostizIntegration,
  type PostizMediaItem,
  type PostizPostType,
} from '../lib/postiz'
import {
  addXThreadEntry,
  createXThreadDraft,
  moveXThreadEntry,
  removeXThreadEntry,
  type XThreadDraft,
} from '../lib/postizThread'
import {
  formatFileSize,
  isAddMediaDisabled,
  MEDIA_ACCEPT,
  mediaKindFromPath,
  validateNewFiles,
  type MediaKind,
} from '../lib/postizMedia'

const POSTIZ_CALLBACK_MESSAGE_TYPE = 'contos:postiz-callback' as const
const POPUP_NAME = 'contos-postiz-oauth'
const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 120_000

type AttachedMedia = {
  localId: string
  kind: MediaKind
  status: 'local' | 'uploading' | 'ready' | 'error'
  previewUrl: string
  file?: File
  fileName?: string
  fileSize?: number
  error?: string
  media?: PostizMediaItem
}

type ConnectionUiState =
  | 'checking'
  | 'disconnected'
  | 'connecting'
  | 'choose_account'
  | 'connected'
  | 'error'

type PostizParentMessage =
  | { type: typeof POSTIZ_CALLBACK_MESSAGE_TYPE; status: 'denied' }
  | { type: typeof POSTIZ_CALLBACK_MESSAGE_TYPE; status: 'error'; message: string }

type PostModalMode = 'create' | 'edit' | 'view'

function isPostizParentMessage(value: unknown): value is PostizParentMessage {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const message = value as { type?: unknown; status?: unknown; message?: unknown }
  if (message.type !== POSTIZ_CALLBACK_MESSAGE_TYPE) {
    return false
  }
  if (message.status === 'denied') {
    return true
  }
  return message.status === 'error' && typeof message.message === 'string'
}

const CALENDAR_CARD =
  'rounded-[1.25rem] border border-border-hairline bg-canvas-raised shadow-[0_4px_24px_rgba(23,21,37,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.35)]'
const CALENDAR_CREATE_BTN =
  'inline-flex w-full items-center justify-center gap-1.5 rounded-2xl border border-[rgba(90,60,130,0.12)] bg-[#DCC8FF] px-4 py-3 text-sm font-semibold text-accent-primary-deep transition-all duration-200 hover:-translate-y-px hover:bg-[#CDB5F5] hover:shadow-[0_6px_16px_rgba(124,77,204,0.18)] dark:border-accent-primary/25 dark:bg-accent-primary dark:text-btn-primary-fg dark:hover:bg-accent-primary-hover'

function stateBadgeClass(state: string): string {
  switch (state.toUpperCase()) {
    case 'PUBLISHED':
      return 'bg-[#EAF8F1] text-[#1A5C3A] dark:bg-signal-positive-soft dark:text-signal-positive'
    case 'QUEUE':
      return 'bg-accent-primary-soft text-accent-primary-deep dark:bg-accent-primary-soft dark:text-accent-primary-deep'
    case 'DRAFT':
      return 'bg-[#FFF0EA] text-[#6F4A38] dark:bg-[#2a221c] dark:text-[#e8c4b0]'
    case 'ERROR':
      return 'bg-[#FFF0EA] text-[#7A3B2E] dark:bg-red-950/50 dark:text-red-300'
    default:
      return 'bg-[#EAF2FF] text-[#3A4A6B] dark:bg-[#1a2230] dark:text-[#a8b8d8]'
  }
}

function stateLabelKey(state: string): string {
  switch (state.toUpperCase()) {
    case 'PUBLISHED':
      return 'postiz.calendar.statePublished'
    case 'QUEUE':
      return 'postiz.calendar.stateScheduled'
    case 'DRAFT':
      return 'postiz.calendar.stateDraft'
    case 'ERROR':
      return 'postiz.calendar.stateFailed'
    default:
      return 'postiz.calendar.stateOther'
  }
}

function calendarStatusKey(state: string, publishDateIso: string, nowMs: number): string {
  if (state.toUpperCase() === 'QUEUE') {
    const when = new Date(publishDateIso).getTime()
    if (!Number.isNaN(when) && when <= nowMs) {
      return 'postiz.calendar.stateNotPublished'
    }
  }
  return stateLabelKey(state)
}

function formatPostTime(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return new Intl.DateTimeFormat(locale || 'en', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatPostDateTime(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return new Intl.DateTimeFormat(locale || 'en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function XMark({ className = 'h-11 w-11' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 44 44" aria-hidden="true">
      <rect width="44" height="44" rx="12" fill="#111" />
      <path
        fill="#fff"
        d="M12.8 13.6h5.1l4.1 5.8 4.2-5.8h4.9l-6.7 9 7 10.8h-5.1l-4.5-6.4-4.6 6.4h-4.9l7.2-9.6-6.7-10.2z"
      />
    </svg>
  )
}

function LinkedInMark({ className = 'h-11 w-11' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 44 44" aria-hidden="true">
      <rect width="44" height="44" rx="12" fill="#0A66C2" />
      <path
        fill="#fff"
        d="M13.2 18.4h4.1v13.2h-4.1V18.4zm2.05-6.55a2.38 2.38 0 110 4.76 2.38 2.38 0 010-4.76zM20.5 18.4h3.95v1.8h.06c.55-.98 1.9-2.02 3.91-2.02 4.18 0 4.95 2.75 4.95 6.33v6.89h-4.1v-6.11c0-1.46-.03-3.33-2.03-3.33-2.03 0-2.34 1.58-2.34 3.21v6.23H20.5V18.4z"
      />
    </svg>
  )
}

type CalendarViewMode = 'month' | 'week' | 'day'
type PlatformFilter = 'all' | 'linkedin' | 'x'

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function startOfWeek(date: Date): Date {
  return addDays(startOfDay(date), -date.getDay())
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function visibleSpan(anchor: Date, viewMode: CalendarViewMode): { start: Date; end: Date } {
  const day = startOfDay(anchor)
  if (viewMode === 'day') {
    return { start: day, end: day }
  }
  if (viewMode === 'week') {
    const start = startOfWeek(day)
    return { start, end: addDays(start, 6) }
  }
  const first = new Date(day.getFullYear(), day.getMonth(), 1)
  const last = new Date(day.getFullYear(), day.getMonth() + 1, 0)
  return { start: startOfWeek(first), end: addDays(startOfWeek(last), 6) }
}

function rangeBounds(start: Date, end: Date): { startDate: string; endDate: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    startDate: localDateTimeToOffsetIso(
      `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T00:00`,
    ),
    endDate: localDateTimeToOffsetIso(
      `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T23:59`,
    ),
  }
}

function eachDay(start: Date, end: Date): Date[] {
  const days: Date[] = []
  for (let cursor = startOfDay(start); cursor.getTime() <= end.getTime(); cursor = addDays(cursor, 1)) {
    days.push(cursor)
  }
  return days
}

function CalendarPageHeader({
  canCreate,
  onCreate,
}: {
  canCreate: boolean
  onCreate?: () => void
}) {
  const { t } = useTranslation()
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-serif text-2xl leading-none text-ink sm:text-3xl">
          {t('placeholder.calendar.title')}
        </h1>
        <p className="mt-1.5 max-w-2xl text-xs text-ink-muted sm:text-sm">
          {t('placeholder.calendar.subtitle')}
        </p>
      </div>
      <button
        type="button"
        disabled={!canCreate}
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 rounded-full bg-[#ddd6fe] px-4 py-2.5 text-sm font-semibold text-[#4b3568] transition hover:bg-[#d4c8fb] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-accent-primary dark:text-btn-primary-fg dark:hover:bg-accent-primary-hover"
      >
        <span aria-hidden="true">+</span>
        {t('postiz.calendar.createPost')}
      </button>
    </header>
  )
}

function AnchoredMenu({
  open,
  onClose,
  triggerRef,
  menuId,
  label,
  children,
}: {
  open: boolean
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  menuId: string
  label: string
  children: ReactNode
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  function placeMenu() {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) {
      return
    }
    const rect = trigger.getBoundingClientRect()
    const gap = 6
    const menuWidth = menu.offsetWidth
    const menuHeight = menu.offsetHeight
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < menuHeight + gap
    const top = openUp ? rect.top - gap - menuHeight : rect.bottom + gap
    const left = rect.right - menuWidth
    setCoords({
      top: Math.max(8, Math.min(top, window.innerHeight - menuHeight - 8)),
      left: Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8)),
    })
  }

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    placeMenu()
    const frame = window.requestAnimationFrame(() => placeMenu())
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', placeMenu)
      window.removeEventListener('scroll', placeMenu, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      onClose()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose, triggerRef])

  if (!open) {
    return null
  }

  return createPortal(
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={label}
      style={{ top: coords?.top ?? -9999, left: coords?.left ?? 0 }}
      className="fixed z-50 min-w-44 rounded-2xl border border-border-hairline bg-white p-1 text-left shadow-[0_16px_40px_rgba(0,0,0,0.18)] dark:bg-canvas-raised"
    >
      {children}
    </div>,
    document.body,
  )
}

const LINKEDIN_CONTENT_LIMIT = 3000
const COMPOSER_EMOJIS = ['😀', '😁', '😂', '🥰', '😍', '🔥', '✨', '👍', '👏', '🙏', '🎉', '💡', '🚀', '💯', '❤️']
const COMPOSER_SECONDARY_BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-border-hairline bg-white px-4 py-2.5 text-sm font-medium text-ink transition hover:bg-[#f6f4fb] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-canvas dark:hover:bg-canvas-raised'
const COMPOSER_PRIMARY_BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#7c5cbf] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#6d4eab] disabled:cursor-not-allowed disabled:opacity-50'

function menuItemClassName(): string {
  return 'block w-full rounded-xl px-3 py-2 text-left text-sm text-ink hover:bg-[#f4effc] disabled:opacity-50 dark:hover:bg-canvas'
}

function ComposerBox({
  id,
  label,
  value,
  onChange,
  readOnly = false,
  maxLength,
  placeholder,
}: {
  id: string
  label?: string
  value: string
  onChange: (next: string) => void
  readOnly?: boolean
  maxLength?: number
  placeholder?: string
}) {
  const { t, i18n } = useTranslation()
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const emojiRootRef = useRef<HTMLDivElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const count = postizContentLength(value)
  const countLabel =
    maxLength != null
      ? t('postiz.calendar.charCountOf', {
          count: new Intl.NumberFormat(i18n.language || 'en').format(count),
          limit: new Intl.NumberFormat(i18n.language || 'en').format(maxLength),
        })
      : t('postiz.calendar.x.charCount', { count })

  useEffect(() => {
    if (!emojiOpen) {
      return
    }
    function onPointerDown(event: MouseEvent) {
      if (!emojiRootRef.current?.contains(event.target as Node)) {
        setEmojiOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [emojiOpen])

  function insert(text: string) {
    const area = areaRef.current
    const start = area?.selectionStart ?? value.length
    const end = area?.selectionEnd ?? value.length
    const room =
      maxLength == null ? text.length : maxLength - (value.length - (end - start))
    if (room <= 0) {
      return
    }
    const insertion = text.slice(0, room)
    const next = value.slice(0, start) + insertion + value.slice(end)
    onChange(next)
    const cursor = start + insertion.length
    window.requestAnimationFrame(() => {
      area?.focus()
      area?.setSelectionRange(cursor, cursor)
    })
  }

  function insertList() {
    const area = areaRef.current
    const start = area?.selectionStart ?? value.length
    const before = value.slice(0, start)
    const needsBreak = before.length > 0 && !before.endsWith('\n')
    insert(`${needsBreak ? '\n' : ''}• `)
  }

  return (
    <div>
      {label ? (
        <label htmlFor={id} className="mb-2 block text-sm font-medium text-ink">
          {label}
        </label>
      ) : null}
      <div className="rounded-2xl border border-border-hairline bg-[#faf9fc] dark:bg-canvas">
        <textarea
          ref={areaRef}
          id={id}
          value={value}
          readOnly={readOnly}
          maxLength={maxLength}
          rows={6}
          placeholder={readOnly ? undefined : placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="w-full resize-none bg-transparent px-4 pt-3 text-sm text-ink outline-none placeholder:text-ink-muted/70 read-only:opacity-90"
        />
        <div className="flex items-center justify-between gap-2 px-3 pb-2">
          {readOnly ? (
            <span />
          ) : (
            <div ref={emojiRootRef} className="relative flex items-center gap-0.5">
              <button
                type="button"
                aria-label={t('postiz.calendar.toolbarEmoji')}
                aria-expanded={emojiOpen}
                onClick={() => setEmojiOpen((current) => !current)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-white hover:text-ink dark:hover:bg-canvas-raised"
              >
                <span aria-hidden="true">☺</span>
              </button>
              <button
                type="button"
                aria-label={t('postiz.calendar.toolbarList')}
                onClick={insertList}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-white hover:text-ink dark:hover:bg-canvas-raised"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
                  <path d="M9 7h11M9 12h11M9 17h11" />
                  <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
                  <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
                  <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={t('postiz.calendar.toolbarHashtag')}
                onClick={() => insert('#')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold text-ink-muted hover:bg-white hover:text-ink dark:hover:bg-canvas-raised"
              >
                #
              </button>
              {emojiOpen ? (
                <div className="absolute bottom-10 left-0 z-10 grid w-52 grid-cols-5 gap-1 rounded-xl border border-border-hairline bg-white p-2 shadow-lg dark:bg-canvas-raised">
                  {COMPOSER_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="rounded-lg px-1 py-1 text-lg hover:bg-[#f4effc] dark:hover:bg-canvas"
                      onClick={() => {
                        insert(emoji)
                        setEmojiOpen(false)
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          <span className="text-xs tabular-nums text-ink-muted">{countLabel}</span>
        </div>
      </div>
    </div>
  )
}

function PostEventChip({
  isX,
  label,
  title,
  onOpen,
}: {
  isX: boolean
  label: string
  title: string
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onOpen}
      className={`flex w-full items-center gap-1 rounded-md px-1.5 py-1 text-left text-[11px] font-medium ${
        isX
          ? 'bg-[#f2f2f4] text-ink dark:bg-[#2c2c30]'
          : 'bg-[#e7f0ff] text-[#1e4f8a] dark:bg-[#1a2740] dark:text-[#d5e4fb]'
      }`}
    >
      {isX ? (
        <XMark className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <LinkedInMark className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span aria-hidden="true" className="shrink-0 text-[10px] opacity-60">
        ···
      </span>
    </button>
  )
}

function AccountRow({
  title,
  subtitle,
  mark,
  connected,
  connectedLabel,
  menuLabel,
  menu,
}: {
  title: string
  subtitle: string
  mark: ReactNode
  connected: boolean
  connectedLabel: string
  menuLabel: string
  menu: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  return (
    <div className="rounded-2xl border border-border-hairline bg-white px-3 py-3 dark:bg-canvas">
      <div className="flex items-start gap-3">
        <div className="shrink-0">{mark}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>
          ) : null}
          {connected ? (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-[#1A5C3A] dark:text-signal-positive">
              <span className="h-1.5 w-1.5 rounded-full bg-[#1fa97e] dark:bg-signal-positive" aria-hidden="true" />
              {connectedLabel}
            </p>
          ) : null}
        </div>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={menuLabel}
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-[#f4effc] dark:hover:bg-canvas-raised"
        >
          <span aria-hidden="true">···</span>
        </button>
      </div>
      <AnchoredMenu
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        menuId={menuId}
        label={menuLabel}
      >
        {menu(() => setOpen(false))}
      </AnchoredMenu>
    </div>
  )
}

export function CalendarPage() {
  const { t } = useTranslation()
  const {
    user,
    projects,
    setProjects,
    activeProject,
    projectId,
    projectsLoading,
    isSigningOut,
    sidebarOpen,
    setSidebarOpen,
    handleSignOut,
  } = useDashboardShell()

  // Prefer the URL projectId. Never call Postiz with a mismatched activeProject
  // (that reused Avatar A's connection while the user was on Avatar B's calendar).
  const avatarId =
    projectId != null && projectId.length > 0
      ? activeProject == null || activeProject.id === projectId
        ? projectId
        : null
      : (activeProject?.id ?? null)

  return (
    <DashboardLayout
      projects={projects}
      activeProject={activeProject}
      onAvatarsChanged={setProjects}
      userEmail={user?.email}
      isSigningOut={isSigningOut}
      onSignOut={() => void handleSignOut()}
      sidebarOpen={sidebarOpen}
      onSidebarOpenChange={setSidebarOpen}
      isLoading={projectsLoading}
      mainClassName="overflow-y-auto bg-white px-4 pb-8 pt-4 sm:px-8 sm:pt-6 dark:bg-canvas"
    >
      {avatarId ? (
        <CalendarPostizPanel key={avatarId} avatarId={avatarId} />
      ) : (
        <>
          <CalendarPageHeader canCreate={false} />
          <section className={`${CALENDAR_CARD} p-8 sm:p-10`}>
            <p className="text-sm text-ink-muted">{t('postiz.calendar.checking')}</p>
          </section>
        </>
      )}
    </DashboardLayout>
  )
}

function XChannelPanel({
  avatarId,
  onIntegrationChange,
  onExposeConnect,
}: {
  avatarId: string
  onIntegrationChange: (integration: PostizIntegration | null) => void
  onExposeConnect: (openConnect: () => void) => void
}) {
  const { t } = useTranslation()
  const [uiState, setUiState] = useState<ConnectionUiState>('checking')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [integration, setIntegration] = useState<PostizIntegration | null>(null)
  const [claimCandidates, setClaimCandidates] = useState<PostizIntegration[]>([])
  const [isClaiming, setIsClaiming] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [connectPrepOpen, setConnectPrepOpen] = useState(false)
  const popupRef = useRef<Window | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const pollDeadlineRef = useRef<number>(0)
  const connectingRef = useRef(false)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const closePopup = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close()
    }
    popupRef.current = null
  }, [])

  const applyConnected = useCallback(
    (nextIntegration: PostizIntegration | null) => {
      connectingRef.current = false
      setIntegration(nextIntegration)
      setClaimCandidates([])
      setUiState('connected')
      setErrorMessage(null)
      stopPolling()
      closePopup()
    },
    [closePopup, stopPolling],
  )

  const applyClaimCandidates = useCallback(
    (candidates: PostizIntegration[]) => {
      connectingRef.current = false
      setClaimCandidates(candidates)
      setUiState('choose_account')
      setErrorMessage(null)
      stopPolling()
      closePopup()
    },
    [closePopup, stopPolling],
  )

  useEffect(() => {
    onIntegrationChange(uiState === 'connected' ? integration : null)
  }, [integration, onIntegrationChange, uiState])

  useEffect(() => {
    let cancelled = false

    async function loadStatus() {
      try {
        const status = await getPostizStatus(avatarId, 'x')
        if (cancelled) {
          return
        }
        if (status.connected) {
          setIntegration(status.integration)
          setClaimCandidates([])
          setUiState('connected')
          setErrorMessage(null)
          return
        }
        if (status.claim_candidates.length > 0) {
          setClaimCandidates(status.claim_candidates)
          setIntegration(null)
          setUiState('choose_account')
          setErrorMessage(null)
          return
        }
        setIntegration(null)
        setClaimCandidates([])
        setUiState('disconnected')
      } catch (error) {
        if (cancelled) {
          return
        }
        setUiState('error')
        setErrorMessage(userFacingMessage(error, t('postiz.calendar.x.statusFailed')))
      }
    }

    void loadStatus()
    return () => {
      cancelled = true
      stopPolling()
      closePopup()
    }
  }, [avatarId, closePopup, stopPolling, t])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) {
        return
      }
      if (!connectingRef.current || !isPostizParentMessage(event.data)) {
        return
      }

      connectingRef.current = false
      stopPolling()
      closePopup()
      setUiState('error')
      setErrorMessage(
        event.data.status === 'denied'
          ? t('postiz.calendar.x.denied')
          : event.data.message,
      )
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [closePopup, stopPolling, t])

  const refreshStatus = useCallback(async (): Promise<boolean> => {
    const status = await getPostizStatus(avatarId, 'x')
    if (status.connected) {
      applyConnected(status.integration)
      return true
    }
    if (status.claim_candidates.length > 0) {
      applyClaimCandidates(status.claim_candidates)
      return false
    }
    setIntegration(null)
    setUiState('disconnected')
    return false
  }, [applyClaimCandidates, applyConnected, avatarId])

  async function handleClaimAccount(candidate: PostizIntegration) {
    setIsClaiming(true)
    setErrorMessage(null)
    try {
      const result = await claimPostizIntegration(avatarId, candidate.id, 'x')
      if (!result.connected || result.integration === null) {
        throw new PostizApiError(t('postiz.calendar.x.claimFailed'))
      }
      applyConnected(result.integration)
    } catch (error) {
      setUiState('error')
      setErrorMessage(userFacingMessage(error, t('postiz.calendar.x.claimFailed')))
    } finally {
      setIsClaiming(false)
    }
  }

  const startPolling = useCallback(() => {
    stopPolling()
    pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS

    pollTimerRef.current = window.setInterval(() => {
      void (async () => {
        if (Date.now() > pollDeadlineRef.current) {
          connectingRef.current = false
          stopPolling()
          closePopup()
          try {
            const status = await getPostizStatus(avatarId, 'x')
            if (status.connected && status.integration) {
              applyConnected(status.integration)
              return
            }
            if (status.claim_candidates.length > 0) {
              applyClaimCandidates(status.claim_candidates)
              return
            }
            setUiState('error')
            setErrorMessage(t('postiz.calendar.x.timeout'))
          } catch (error) {
            setUiState('error')
            setErrorMessage(userFacingMessage(error, t('postiz.calendar.x.timeout')))
          }
          return
        }

        try {
          await refreshStatus()
        } catch {
          // Keep polling until timeout; transient errors are expected mid-OAuth.
        }
      })()
    }, POLL_INTERVAL_MS)
  }, [applyClaimCandidates, applyConnected, avatarId, closePopup, refreshStatus, stopPolling, t])

  async function handleConnectX() {
    setConnectPrepOpen(false)
    setErrorMessage(null)
    connectingRef.current = true
    setUiState('connecting')

    const popup = window.open('about:blank', 'contos-postiz-oauth-x', 'width=640,height=720')
    popupRef.current = popup
    if (!popup) {
      connectingRef.current = false
      setUiState('error')
      setErrorMessage(t('postiz.calendar.x.popupBlocked'))
      return
    }

    try {
      const result = await startPostizConnect(avatarId, 'x')
      popup.location.href = result.authorization_url
      startPolling()
    } catch (error) {
      connectingRef.current = false
      popup.close()
      popupRef.current = null
      setUiState('error')
      setErrorMessage(userFacingMessage(error, t('postiz.calendar.x.connectFailed')))
    }
  }

  async function handleDisconnectConfirm() {
    setIsDisconnecting(true)
    setErrorMessage(null)
    try {
      await disconnectPostizIntegration(avatarId, 'x')
      setDisconnectOpen(false)
      setIntegration(null)
      setUiState('disconnected')
    } catch (error) {
      setErrorMessage(userFacingMessage(error, t('postiz.calendar.x.disconnectFailed')))
    } finally {
      setIsDisconnecting(false)
    }
  }

  useEffect(() => {
    onExposeConnect(() => setConnectPrepOpen(true))
  }, [onExposeConnect])

  const xSubtitle =
    uiState === 'checking'
      ? t('postiz.calendar.x.checking')
      : uiState === 'connecting'
        ? t('postiz.calendar.x.connectingTitle')
        : uiState === 'error'
          ? (errorMessage ?? t('postiz.calendar.x.connectFailed'))
          : uiState === 'connected'
            ? (integration?.name ?? '')
            : t('postiz.calendar.notConnected')

  return (
    <>
      <AccountRow
        title={t('postiz.calendar.x.connectedTitle')}
        subtitle={xSubtitle}
        mark={<XMark className="h-10 w-10" />}
        connected={uiState === 'connected'}
        connectedLabel={t('postiz.calendar.connectedStatus')}
        menuLabel={t('postiz.calendar.accountActions', { name: t('postiz.calendar.x.connectedTitle') })}
        menu={(close) => (
          <>
            {uiState === 'connected' ? (
              <button
                type="button"
                role="menuitem"
                className={menuItemClassName()}
                onClick={() => {
                  close()
                  setConnectPrepOpen(true)
                }}
              >
                {t('postiz.calendar.reconnectLinkedIn')}
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                className={menuItemClassName()}
                onClick={() => {
                  close()
                  setConnectPrepOpen(true)
                }}
              >
                {uiState === 'error' ? t('common.retry') : t('postiz.calendar.x.connect')}
              </button>
            )}
            {uiState === 'connected' ? (
              <button
                type="button"
                role="menuitem"
                className={`${menuItemClassName()} text-red-700 dark:text-red-300`}
                onClick={() => {
                  close()
                  setDisconnectOpen(true)
                }}
              >
                {t('postiz.calendar.x.disconnect')}
              </button>
            ) : null}
          </>
        )}
      />

      {uiState === 'choose_account' ? (
        <div className="rounded-2xl border border-border-hairline bg-white px-3 py-3 dark:bg-canvas">
          <p className="text-sm font-semibold text-ink">{t('postiz.calendar.x.chooseTitle')}</p>
          <p className="mt-1 text-xs text-ink-muted">{t('postiz.calendar.x.chooseBody')}</p>
          <ul className="mt-3 space-y-2">
            {claimCandidates.map((candidate) => (
              <li key={candidate.id} className="flex items-center justify-between gap-3">
                <span className="truncate text-sm text-ink">{candidate.name}</span>
                <button
                  type="button"
                  disabled={isClaiming}
                  onClick={() => void handleClaimAccount(candidate)}
                  className={`${CALENDAR_CREATE_BTN} w-auto px-3 py-2`}
                >
                  {t('postiz.calendar.useThisAccount')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmDialog
        open={connectPrepOpen}
        title={t('postiz.calendar.x.connectPrepTitle')}
        description={t('postiz.calendar.connectAccountHint')}
        confirmLabel={t('postiz.calendar.x.connectPrepConfirm')}
        cancelLabel={t('common.cancel')}
        tone="default"
        onConfirm={() => void handleConnectX()}
        onCancel={() => setConnectPrepOpen(false)}
      />

      <ConfirmDialog
        open={disconnectOpen}
        title={t('postiz.calendar.x.disconnectTitle')}
        description={t('postiz.calendar.x.disconnectBody')}
        confirmLabel={t('postiz.calendar.x.disconnectConfirm')}
        confirming={isDisconnecting}
        tone="danger"
        onConfirm={() => void handleDisconnectConfirm()}
        onCancel={() => {
          if (!isDisconnecting) {
            setDisconnectOpen(false)
          }
        }}
      />
    </>
  )
}

function CalendarPostizPanel({ avatarId }: { avatarId: string }) {
  const { t } = useTranslation()
  const [uiState, setUiState] = useState<ConnectionUiState>('checking')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [integration, setIntegration] = useState<PostizIntegration | null>(null)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [connectPrepOpen, setConnectPrepOpen] = useState(false)
  const [disconnectWarning, setDisconnectWarning] = useState<string | null>(null)
  const [xIntegration, setXIntegration] = useState<PostizIntegration | null>(null)
  const [connectMenuOpen, setConnectMenuOpen] = useState(false)
  const xConnectRef = useRef<(() => void) | null>(null)
  const connectMenuRef = useRef<HTMLButtonElement>(null)
  const connectMenuId = useId()
  const exposeXConnect = useCallback((openConnect: () => void) => {
    xConnectRef.current = openConnect
  }, [])
  const popupRef = useRef<Window | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const pollDeadlineRef = useRef<number>(0)
  const linkedinConnectingRef = useRef(false)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const closePopup = useCallback(() => {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.close()
    }
    popupRef.current = null
  }, [])

  const applyConnected = useCallback(
    (nextIntegration: PostizIntegration | null) => {
      linkedinConnectingRef.current = false
      setIntegration(nextIntegration)
      setUiState('connected')
      setErrorMessage(null)
      stopPolling()
      closePopup()
    },
    [closePopup, stopPolling],
  )

  useEffect(() => {
    let cancelled = false

    async function loadStatus() {
      try {
        const status = await getPostizStatus(avatarId)
        if (cancelled) {
          return
        }
        if (status.connected) {
          setIntegration(status.integration)
          setUiState('connected')
          setErrorMessage(null)
          return
        }
        setIntegration(null)
        setUiState('disconnected')
      } catch (error) {
        if (cancelled) {
          return
        }
        setUiState('error')
        setErrorMessage(userFacingMessage(error, t('postiz.calendar.statusFailed')))
      }
    }

    void loadStatus()
    return () => {
      cancelled = true
      stopPolling()
      closePopup()
    }
  }, [avatarId, closePopup, stopPolling, t])

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) {
        return
      }
      if (!linkedinConnectingRef.current || !isPostizParentMessage(event.data)) {
        return
      }

      linkedinConnectingRef.current = false
      stopPolling()
      closePopup()
      setUiState('error')
      setErrorMessage(
        event.data.status === 'denied'
          ? t('postiz.calendar.denied')
          : event.data.message,
      )
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [closePopup, stopPolling, t])

  useEffect(() => {
    return () => {
      stopPolling()
    }
  }, [stopPolling])

  const refreshStatus = useCallback(async (): Promise<boolean> => {
    const status = await getPostizStatus(avatarId)
    if (status.connected) {
      applyConnected(status.integration)
      return true
    }
    setIntegration(null)
    return false
  }, [applyConnected, avatarId])

  async function loadInitialStatus() {
    setUiState('checking')
    setErrorMessage(null)
    try {
      const status = await getPostizStatus(avatarId)
      if (status.connected) {
        applyConnected(status.integration)
        return
      }
      setIntegration(null)
      setUiState('disconnected')
    } catch (error) {
      setUiState('error')
      setErrorMessage(userFacingMessage(error, t('postiz.calendar.statusFailed')))
    }
  }

  const startPolling = useCallback(() => {
    stopPolling()
    pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS

    pollTimerRef.current = window.setInterval(() => {
      void (async () => {
        if (Date.now() > pollDeadlineRef.current) {
          linkedinConnectingRef.current = false
          stopPolling()
          closePopup()
          try {
            const status = await getPostizStatus(avatarId)
            if (status.connected && status.integration) {
              applyConnected(status.integration)
              return
            }
            setUiState('error')
            setErrorMessage(t('postiz.calendar.timeout'))
          } catch (error) {
            setUiState('error')
            setErrorMessage(userFacingMessage(error, t('postiz.calendar.timeout')))
          }
          return
        }

        try {
          const connected = await refreshStatus()
          if (connected) {
            return
          }
        } catch {
          // Keep polling until timeout; transient errors are expected mid-OAuth.
        }
      })()
    }, POLL_INTERVAL_MS)
  }, [applyConnected, avatarId, closePopup, refreshStatus, stopPolling, t])

  async function handleConnectLinkedIn() {
    setConnectPrepOpen(false)
    setErrorMessage(null)
    linkedinConnectingRef.current = true
    setUiState('connecting')

    const popup = window.open('about:blank', POPUP_NAME, 'width=640,height=720')
    popupRef.current = popup
    if (!popup) {
      linkedinConnectingRef.current = false
      setUiState('error')
      setErrorMessage(t('postiz.calendar.popupBlocked'))
      return
    }

    try {
      const result = await startPostizConnect(avatarId)
      popup.location.href = result.authorization_url
      startPolling()
    } catch (error) {
      linkedinConnectingRef.current = false
      popup.close()
      popupRef.current = null
      setUiState('error')
      setErrorMessage(userFacingMessage(error, t('postiz.calendar.connectFailed')))
    }
  }

  function requestConnectLinkedIn() {
    setErrorMessage(null)
    setConnectPrepOpen(true)
  }

  async function handleDisconnectConfirm() {
    setIsDisconnecting(true)
    setErrorMessage(null)
    try {
      const result = await disconnectPostizIntegration(avatarId)
      setDisconnectOpen(false)
      setDisconnectWarning(result.warning)
      setIntegration(null)
      setUiState('disconnected')
    } catch (error) {
      setErrorMessage(userFacingMessage(error, t('postiz.calendar.disconnectFailed')))
    } finally {
      setIsDisconnecting(false)
    }
  }

  return (
    <>
      <AvatarCalendarBoard
        avatarId={avatarId}
        xIntegrationId={xIntegration?.id ?? null}
        canCreate={uiState === 'connected' || xIntegration != null}
        accounts={
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-ink">{t('postiz.calendar.connectedAccounts')}</h2>
            {disconnectWarning ? (
              <p role="status" className="text-sm text-amber-950 dark:text-amber-100">
                {disconnectWarning}
              </p>
            ) : null}
            <AccountRow
              title={t('postiz.calendar.connectedTitle')}
              subtitle={
                uiState === 'checking'
                  ? t('postiz.calendar.checking')
                  : uiState === 'connecting'
                    ? t('postiz.calendar.connectingTitle')
                    : uiState === 'error'
                      ? (errorMessage ?? t('postiz.calendar.connectFailed'))
                      : uiState === 'connected'
                        ? (integration?.name ?? '')
                        : t('postiz.calendar.notConnected')
              }
              mark={<LinkedInMark className="h-10 w-10" />}
              connected={uiState === 'connected'}
              connectedLabel={t('postiz.calendar.connectedStatus')}
              menuLabel={t('postiz.calendar.accountActions', {
                name: t('postiz.calendar.connectedTitle'),
              })}
              menu={(close) => (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItemClassName()}
                    onClick={() => {
                      close()
                      void loadInitialStatus()
                    }}
                  >
                    {t('postiz.calendar.refreshStatus')}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={menuItemClassName()}
                    onClick={() => {
                      close()
                      requestConnectLinkedIn()
                    }}
                  >
                    {uiState === 'connected'
                      ? t('postiz.calendar.reconnectLinkedIn')
                      : uiState === 'error'
                        ? t('common.retry')
                        : t('postiz.calendar.connectLinkedIn')}
                  </button>
                  {uiState === 'connected' ? (
                    <button
                      type="button"
                      role="menuitem"
                      className={`${menuItemClassName()} text-red-700 dark:text-red-300`}
                      onClick={() => {
                        close()
                        setDisconnectOpen(true)
                      }}
                    >
                      {t('postiz.calendar.disconnectLinkedIn')}
                    </button>
                  ) : null}
                </>
              )}
            />
            <XChannelPanel
              avatarId={avatarId}
              onIntegrationChange={setXIntegration}
              onExposeConnect={exposeXConnect}
            />
            {(uiState === 'connected') !== (xIntegration != null) ? (
              <>
                <button
                  ref={connectMenuRef}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={connectMenuOpen}
                  aria-controls={connectMenuOpen ? connectMenuId : undefined}
                  onClick={() => setConnectMenuOpen((current) => !current)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#c4b5fd] bg-white px-4 py-2.5 text-sm font-semibold text-[#5b3d8a] transition hover:bg-[#f6f1ff] dark:border-accent-primary/40 dark:bg-canvas dark:text-accent-primary-deep dark:hover:bg-canvas-raised"
                >
                  <span aria-hidden="true">+</span>
                  {t('postiz.calendar.connectAnother')}
                </button>
                <AnchoredMenu
                  open={connectMenuOpen}
                  onClose={() => setConnectMenuOpen(false)}
                  triggerRef={connectMenuRef}
                  menuId={connectMenuId}
                  label={t('postiz.calendar.connectAnother')}
                >
                  {uiState === 'disconnected' || uiState === 'error' ? (
                    <button
                      type="button"
                      role="menuitem"
                      className={menuItemClassName()}
                      onClick={() => {
                        setConnectMenuOpen(false)
                        requestConnectLinkedIn()
                      }}
                    >
                      {t('postiz.calendar.connectLinkedIn')}
                    </button>
                  ) : null}
                  {xIntegration == null ? (
                    <button
                      type="button"
                      role="menuitem"
                      className={menuItemClassName()}
                      onClick={() => {
                        setConnectMenuOpen(false)
                        xConnectRef.current?.()
                      }}
                    >
                      {t('postiz.calendar.x.connect')}
                    </button>
                  ) : null}
                  {uiState !== 'disconnected' &&
                  uiState !== 'error' &&
                  uiState !== 'connected' &&
                  xIntegration != null ? (
                    <p className="px-3 py-2 text-sm text-ink-muted">
                      {uiState === 'checking'
                        ? t('postiz.calendar.checking')
                        : uiState === 'choose_account'
                          ? t('postiz.calendar.chooseTitle')
                          : t('postiz.calendar.connectingTitle')}
                    </p>
                  ) : null}
                </AnchoredMenu>
              </>
            ) : null}
          </div>
        }
      />

      <ConfirmDialog
        open={connectPrepOpen}
        title={t('postiz.calendar.connectPrepTitle')}
        description={t('postiz.calendar.connectAccountHint')}
        confirmLabel={t('postiz.calendar.connectPrepConfirm')}
        cancelLabel={t('common.cancel')}
        tone="default"
        onConfirm={() => void handleConnectLinkedIn()}
        onCancel={() => setConnectPrepOpen(false)}
      />

      <ConfirmDialog
        open={disconnectOpen}
        title={t('postiz.calendar.disconnectTitle')}
        description={t('postiz.calendar.disconnectBody')}
        confirmLabel={t('postiz.calendar.disconnectConfirm')}
        confirming={isDisconnecting}
        tone="danger"
        onConfirm={() => void handleDisconnectConfirm()}
        onCancel={() => {
          if (!isDisconnecting) {
            setDisconnectOpen(false)
          }
        }}
      />
    </>
  )
}

function AvatarCalendarBoard({
  avatarId,
  xIntegrationId,
  canCreate,
  accounts,
}: {
  avatarId: string
  xIntegrationId: string | null
  canCreate: boolean
  accounts: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month')
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef<HTMLButtonElement>(null)
  const filterMenuId = useId()
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [posts, setPosts] = useState<PostizCalendarPost[]>([])
  const [loading, setLoading] = useState(canCreate)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<PostModalMode>('create')
  const [editingPost, setEditingPost] = useState<PostizCalendarPost | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formContent, setFormContent] = useState('')
  const [formWhen, setFormWhen] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [composerPlatform, setComposerPlatform] = useState<PostizPlatform>('linkedin')
  const [xThreadEntries, setXThreadEntries] = useState<XThreadDraft[]>(() => [
    createXThreadDraft(),
  ])
  const [attachments, setAttachments] = useState<AttachedMedia[]>([])
  const [reloadToken, setReloadToken] = useState(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    return () => {
      for (const item of attachments) {
        if (item.file && item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl)
        }
      }
    }
    // Revoke only on unmount; per-item revoke happens on remove.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const displaySpan = useMemo(() => visibleSpan(anchor, viewMode), [anchor, viewMode])
  const fetchSpan = useMemo(() => {
    const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
    return {
      start: displaySpan.start.getTime() < monthStart.getTime() ? displaySpan.start : monthStart,
      end: displaySpan.end.getTime() > monthEnd.getTime() ? displaySpan.end : monthEnd,
    }
  }, [anchor, displaySpan])
  const spanKey = `${dateKey(fetchSpan.start)}:${dateKey(fetchSpan.end)}`

  useEffect(() => {
    if (!canCreate) {
      setPosts([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    let cancelled = false

    async function fetchPosts() {
      try {
        const { startDate, endDate } = rangeBounds(fetchSpan.start, fetchSpan.end)
        const next = await listPostizPosts(avatarId, startDate, endDate)
        if (cancelled) {
          return
        }
        setPosts(next)
        setError(null)
      } catch (err) {
        if (cancelled) {
          return
        }
        setPosts([])
        setError(userFacingMessage(err, t('postiz.calendar.postsLoadFailed')))
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void fetchPosts()
    return () => {
      cancelled = true
    }
  }, [avatarId, canCreate, fetchSpan.end, fetchSpan.start, reloadToken, spanKey, t])

  function beginPostsReload() {
    setLoading(true)
    setError(null)
    setPosts([])
    setReloadToken((value) => value + 1)
  }

  /** Re-list the visible range so a past-due QUEUE badge is not used after Postiz published. */
  async function refreshPostsInView(): Promise<PostizCalendarPost[]> {
    const { startDate, endDate } = rangeBounds(fetchSpan.start, fetchSpan.end)
    const next = await listPostizPosts(avatarId, startDate, endDate)
    setPosts(next)
    setError(null)
    return next
  }

  async function resolveFreshPost(postId: string): Promise<PostizCalendarPost | null> {
    const next = await refreshPostsInView()
    return next.find((item) => item.id === postId) ?? null
  }

  function shiftAnchor(direction: -1 | 1) {
    setExpandedDay(null)
    setLoading(canCreate)
    setError(null)
    setPosts([])
    setAnchor((current) => {
      if (viewMode === 'month') {
        return new Date(current.getFullYear(), current.getMonth() + direction, 1)
      }
      if (viewMode === 'week') {
        return addDays(current, 7 * direction)
      }
      return addDays(current, direction)
    })
  }

  function goToToday() {
    setExpandedDay(null)
    setLoading(canCreate)
    setError(null)
    setPosts([])
    setAnchor(startOfDay(new Date()))
  }

  function postIsX(post: PostizCalendarPost): boolean {
    return xIntegrationId != null && post.integration_id === xIntegrationId
  }

  function postMatchesFilter(post: PostizCalendarPost): boolean {
    if (platformFilter === 'x') {
      return postIsX(post)
    }
    if (platformFilter === 'linkedin') {
      return !postIsX(post)
    }
    return true
  }

  const postsByDay = useMemo(() => {
    const map = new Map<string, PostizCalendarPost[]>()
    for (const post of posts) {
      if (!postMatchesFilter(post)) {
        continue
      }
      const d = new Date(post.publish_date)
      if (Number.isNaN(d.getTime())) {
        continue
      }
      const key = dateKey(d)
      const list = map.get(key) ?? []
      list.push(post)
      map.set(key, list)
    }
    return map
  }, [platformFilter, posts, xIntegrationId])

  const periodLabel = useMemo(() => {
    const locale = i18n.language || 'en'
    if (viewMode === 'day') {
      return new Intl.DateTimeFormat(locale, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(anchor)
    }
    if (viewMode === 'week') {
      const sameMonth =
        displaySpan.start.getMonth() === displaySpan.end.getMonth() &&
        displaySpan.start.getFullYear() === displaySpan.end.getFullYear()
      if (sameMonth) {
        const month = new Intl.DateTimeFormat(locale, { month: 'long' }).format(displaySpan.start)
        return `${month} ${displaySpan.start.getDate()}–${displaySpan.end.getDate()}, ${displaySpan.start.getFullYear()}`
      }
      const left = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(displaySpan.start)
      const right = new Intl.DateTimeFormat(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(displaySpan.end)
      return `${left} – ${right}`
    }
    return new Intl.DateTimeFormat(locale, {
      month: 'long',
      year: 'numeric',
    }).format(anchor)
  }, [anchor, displaySpan.end, displaySpan.start, i18n.language, viewMode])

  const nowMs = Date.now()

  const upcomingPosts = useMemo(() => {
    return posts
      .filter((post) => {
        if (post.state.toUpperCase() === 'PUBLISHED') {
          return false
        }
        const d = new Date(post.publish_date)
        return (
          !Number.isNaN(d.getTime()) &&
          d.getFullYear() === anchor.getFullYear() &&
          d.getMonth() === anchor.getMonth() &&
          postMatchesFilter(post)
        )
      })
      .sort((a, b) => new Date(a.publish_date).getTime() - new Date(b.publish_date).getTime())
  }, [anchor, platformFilter, posts, xIntegrationId])

  const today = useMemo(() => startOfDay(new Date()), [])

  const monthCells = useMemo(
    () => eachDay(displaySpan.start, displaySpan.end),
    [displaySpan.end, displaySpan.start],
  )

  const attachmentsRef = useRef<AttachedMedia[]>([])
  attachmentsRef.current = attachments

  function clearAttachments() {
    setAttachments((prev) => {
      for (const item of prev) {
        if (item.file && item.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.previewUrl)
        }
      }
      return []
    })
  }

  function openCreate(date?: Date) {
    if (!canCreate) {
      return
    }
    setModalMode('create')
    setEditingPost(null)
    setComposerPlatform('linkedin')
    setFormContent('')
    setXThreadEntries([createXThreadDraft()])
    setFormError(null)
    clearAttachments()
    const pad = (n: number) => String(n).padStart(2, '0')
    const base =
      date != null
        ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0)
        : new Date(Date.now() + 60 * 60 * 1000)
    setFormWhen(
      `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(base.getHours())}:${pad(base.getMinutes())}`,
    )
    setModalOpen(true)
  }

  function isXPost(post: PostizCalendarPost): boolean {
    return postIsX(post)
  }

  function xPostIsEditable(post: PostizCalendarPost): boolean {
    if (!isXPost(post)) {
      return false
    }
    const state = post.state.toUpperCase()
    return state === 'DRAFT' || state === 'QUEUE'
  }

  function applyEditForm(post: PostizCalendarPost) {
    const xPost = isXPost(post)
    setComposerPlatform(xPost ? 'x' : 'linkedin')
    setModalMode(xPost && !xPostIsEditable(post) ? 'view' : 'edit')
    setEditingPost(post)
    setFormContent(post.content)
    setFormWhen(isoToLocalDateTimeInput(post.publish_date))
    clearAttachments()
    setAttachments(
      post.images.map((image) => ({
        localId: image.id,
        kind: mediaKindFromPath(image.path),
        status: 'ready' as const,
        previewUrl: image.path,
        fileName: image.original_name ?? image.name ?? undefined,
        media: image,
      })),
    )
  }

  function openEdit(post: PostizCalendarPost) {
    setFormError(null)
    applyEditForm(post)
    setModalOpen(true)
    void (async () => {
      try {
        const fresh = await resolveFreshPost(post.id)
        if (fresh == null) {
          setFormError(t('postiz.calendar.postGone'))
          setModalOpen(false)
          setEditingPost(null)
          return
        }
        applyEditForm(fresh)
        if (fresh.state.toUpperCase() === 'PUBLISHED' && post.state.toUpperCase() !== 'PUBLISHED') {
          setFormError(t('postiz.calendar.alreadyPublished'))
        }
      } catch (err) {
        setFormError(userFacingMessage(err, t('postiz.calendar.postsLoadFailed')))
      }
    })()
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return
    }
    // FileList is live — clearing the input empties it. Snapshot before reset.
    const files = Array.from(fileList)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setFormError(null)

    const maxImages =
      composerPlatform === 'x' ? POSTIZ_MAX_X_POST_IMAGES : POSTIZ_MAX_POST_IMAGES
    const validation = validateNewFiles(
      attachmentsRef.current.map((item) => ({ kind: item.kind })),
      files,
      maxImages,
    )
    if (!validation.ok) {
      setFormError(
        t(`postiz.calendar.${validation.errorKey}`, validation.errorParams ?? {}),
      )
      return
    }
    if (validation.accepted.length === 0) {
      return
    }

    setAttachments((prev) => {
      const next = [...prev]
      const created: AttachedMedia[] = []
      for (const { file, kind } of validation.accepted) {
        const entry: AttachedMedia = {
          localId: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
          kind,
          status: 'local',
          previewUrl: URL.createObjectURL(file),
          file,
          fileName: file.name,
          fileSize: file.size,
        }
        created.push(entry)
        next.push(entry)
      }
      // Keep ref in sync before microtask: otherwise uploadAttachment can miss
      // the new entry and show mediaUploadFailed without calling ContOS.
      attachmentsRef.current = next
      if (created.length > 0) {
        queueMicrotask(() => {
          for (const entry of created) {
            void uploadAttachment(entry.localId, entry.file)
          }
        })
      }
      return next
    })
  }

  function sanitizeUploadErrorMessage(raw: string): string {
    const message = raw.trim()
    if (/<\/?html/i.test(message) || /gateway time-?out/i.test(message) || /\b504\b/.test(message)) {
      return t('postiz.calendar.mediaUploadTimeout')
    }
    if (/\b502\b/.test(message) && /bad gateway/i.test(message)) {
      return t('postiz.calendar.mediaUploadTimeout')
    }
    return message || t('postiz.calendar.mediaUploadFailed')
  }

  async function uploadAttachment(
    localId: string,
    fileOverride?: File,
  ): Promise<PostizMediaItem> {
    const current = attachmentsRef.current.find((item) => item.localId === localId)
    if (current?.status === 'ready' && current.media) {
      return current.media
    }
    const file = fileOverride ?? current?.file
    if (!file) {
      const message = t('postiz.calendar.mediaUploadFailed')
      setAttachments((prev) =>
        prev.map((entry) =>
          entry.localId === localId ? { ...entry, status: 'error', error: message } : entry,
        ),
      )
      throw new PostizApiError(message)
    }

    setAttachments((prev) =>
      prev.map((entry) =>
        entry.localId === localId
          ? { ...entry, status: 'uploading', error: undefined, file }
          : entry,
      ),
    )

    try {
      const uploaded = await uploadPostizMedia(avatarId, file)
      setFormError(null)
      setAttachments((prev) =>
        prev.map((entry) =>
          entry.localId === localId
            ? { ...entry, status: 'ready', media: uploaded, error: undefined, file }
            : entry,
        ),
      )
      return uploaded
    } catch (err) {
      const message = sanitizeUploadErrorMessage(
        userFacingMessage(err, t('postiz.calendar.mediaUploadFailed')),
      )
      setAttachments((prev) =>
        prev.map((entry) =>
          entry.localId === localId ? { ...entry, status: 'error', error: message } : entry,
        ),
      )
      setFormError(message)
      throw new PostizApiError(message)
    }
  }

  function removeAttachment(localId: string) {
    setAttachments((prev) => {
      const target = prev.find((item) => item.localId === localId)
      if (target?.file && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl)
      }
      return prev.filter((item) => item.localId !== localId)
    })
  }

  function moveAttachment(localId: string, direction: -1 | 1) {
    setAttachments((prev) => {
      const index = prev.findIndex((item) => item.localId === localId)
      if (index < 0) {
        return prev
      }
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= prev.length) {
        return prev
      }
      const next = [...prev]
      const [item] = next.splice(index, 1)
      next.splice(nextIndex, 0, item)
      return next
    })
  }

  async function resolveFinalImages(): Promise<PostizMediaItem[]> {
    const snapshot = attachmentsRef.current
    if (snapshot.some((item) => item.status === 'uploading')) {
      throw new PostizApiError(t('postiz.calendar.mediaStillUploading'))
    }
    const resolved: PostizMediaItem[] = []
    for (const item of snapshot) {
      if (item.status === 'ready' && item.media) {
        resolved.push(item.media)
        continue
      }
      if (item.status === 'error') {
        throw new PostizApiError(
          sanitizeUploadErrorMessage(item.error || t('postiz.calendar.mediaUploadFailed')),
        )
      }
      if (item.file) {
        resolved.push(await uploadAttachment(item.localId))
        continue
      }
      throw new PostizApiError(t('postiz.calendar.mediaUploadFailed'))
    }
    return resolved
  }

  async function submitPost(type: Exclude<PostizPostType, 'update'>) {
    setSaving(true)
    setFormError(null)
    try {
      const images = await resolveFinalImages()
      const publishDate =
        type === 'now' ? nowAsOffsetIso() : localDateTimeToOffsetIso(formWhen)
      const postingToX = composerPlatform === 'x'
      await createPostizPost({
        avatarId,
        type,
        content: postingToX ? xThreadEntries[0].content : formContent,
        publishDate,
        images,
        ...(postingToX
          ? {
              platform: 'x' as const,
              posts: xThreadEntries.map((entry) => ({ content: entry.content })),
            }
          : {}),
      })
      setModalOpen(false)
      clearAttachments()
      beginPostsReload()
    } catch (err) {
      setFormError(userFacingMessage(err, t('postiz.calendar.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function submitExistingPost(type: 'update' | 'now') {
    if (!editingPost) {
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      // Complete final image array (including [] if all removed).
      const images = await resolveFinalImages()
      const publishDate =
        type === 'now' ? nowAsOffsetIso() : localDateTimeToOffsetIso(formWhen)
      await createPostizPost({
        avatarId,
        type,
        content: formContent,
        publishDate,
        postId: editingPost.id,
        images,
        ...(composerPlatform === 'x' ? { platform: 'x' as const } : {}),
      })
      setModalOpen(false)
      clearAttachments()
      beginPostsReload()
    } catch (err) {
      setFormError(userFacingMessage(err, t('postiz.calendar.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function submitUpdate() {
    if (!editingPost) {
      return
    }
    let publishInFuture = false
    try {
      publishInFuture = new Date(localDateTimeToOffsetIso(formWhen)).getTime() > Date.now()
    } catch {
      publishInFuture = false
    }
    // Past or immediate wall time must publish now so Postiz does not keep a past QUEUE.
    await submitExistingPost(publishInFuture ? 'update' : 'now')
  }

  async function submitPublishNowExisting() {
    await submitExistingPost('now')
  }

  async function submitStatus(status: 'draft' | 'schedule') {
    if (!editingPost) {
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await changePostizPostStatus(avatarId, editingPost.id, status)
      setModalOpen(false)
      beginPostsReload()
    } catch (err) {
      setFormError(userFacingMessage(err, t('postiz.calendar.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!editingPost) {
      return
    }
    setDeleting(true)
    setFormError(null)
    try {
      const fresh = await resolveFreshPost(editingPost.id)
      if (fresh == null) {
        setDeleteOpen(false)
        setModalOpen(false)
        setEditingPost(null)
        return
      }
      if (isXPost(fresh) && fresh.state.toUpperCase() === 'PUBLISHED') {
        applyEditForm(fresh)
        setDeleteOpen(false)
        setFormError(t('postiz.calendar.alreadyPublished'))
        return
      }
      await deletePostizPost(avatarId, editingPost.id)
      setDeleteOpen(false)
      setModalOpen(false)
      setEditingPost(null)
      beginPostsReload()
    } catch (err) {
      setDeleteOpen(false)
      setFormError(userFacingMessage(err, t('postiz.calendar.deleteFailed')))
    } finally {
      setDeleting(false)
    }
  }

  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language || 'en', {
      weekday: 'short',
    })
    // 2024-01-07 is a Sunday, so the labels match the Sunday-first grid.
    return Array.from({ length: 7 }, (_, index) =>
      formatter.format(new Date(2024, 0, 7 + index)).toUpperCase(),
    )
  }, [i18n.language])

  const composerMaxImages =
    composerPlatform === 'x' ? POSTIZ_MAX_X_POST_IMAGES : POSTIZ_MAX_POST_IMAGES
  const composerImageCount = attachments.filter((item) => item.kind === 'image').length
  const composerOverImageLimit = composerImageCount > composerMaxImages
  const mediaBlocksSave =
    composerOverImageLimit ||
    attachments.some((item) => item.status === 'uploading') ||
    attachments.some((item) => item.status === 'error')
  const contentBlocksSave =
    composerPlatform === 'x'
      ? xThreadEntries.some((entry) => !entry.content.trim())
      : !formContent.trim()

  return (
    <>
      <CalendarPageHeader canCreate={canCreate} onCreate={() => openCreate()} />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <section className={`${CALENDAR_CARD} w-full shrink-0 p-4 sm:p-5 lg:w-[20.5rem]`}>
          {accounts}
          <button
            type="button"
            className={`${CALENDAR_CREATE_BTN} mt-4 disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={!canCreate}
            onClick={() => openCreate()}
          >
            <span aria-hidden="true">+</span>
            {t('postiz.calendar.createPost')}
          </button>
          <div className="mt-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4 text-ink-muted">
                <rect x="3.5" y="5" width="17" height="15" rx="2" />
                <path d="M8 3.5v3M16 3.5v3M3.5 10h17" />
              </svg>
              {t('postiz.calendar.upcomingThisMonth')}
            </h3>
            {loading ? (
              <p className="mt-3 text-sm text-ink-muted">{t('postiz.calendar.loadingPosts')}</p>
            ) : null}
            {!loading && upcomingPosts.length === 0 ? (
              <div className="mt-3 space-y-1 text-sm text-ink-muted">
                <p>{t('postiz.calendar.noUpcomingPosts')}</p>
                <p>{t('postiz.calendar.noUpcomingHint')}</p>
              </div>
            ) : null}
            <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-0.5">
              {upcomingPosts.map((post) => (
                <li key={post.id}>
                  <button
                    type="button"
                    onClick={() => openEdit(post)}
                    title={post.content}
                    className="w-full rounded-2xl border border-border-hairline bg-white px-3 py-2.5 text-left dark:bg-canvas"
                  >
                    <p className="text-[11px] font-medium text-ink-muted">
                      {isXPost(post) ? `${t('postiz.calendar.platformX')} · ` : ''}
                      {t(calendarStatusKey(post.state, post.publish_date, nowMs))}
                      {' · '}
                      {formatPostDateTime(post.publish_date, i18n.language)}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm font-medium text-ink">
                      {post.content.slice(0, 80) || t('postiz.calendar.untitledPost')}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={`${CALENDAR_CARD} min-w-0 flex-1 p-4 sm:p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={goToToday}
                className="rounded-full border border-border-hairline bg-white px-3 py-1.5 text-sm font-medium text-ink dark:bg-canvas"
              >
                {t('postiz.calendar.today')}
              </button>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-[#f4effc] dark:hover:bg-canvas"
                onClick={() => shiftAnchor(-1)}
                aria-label={t('postiz.calendar.prevMonth')}
              >
                <span aria-hidden="true">‹</span>
              </button>
              <h3 className="min-w-[9rem] text-center text-base font-semibold text-ink">{periodLabel}</h3>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-[#f4effc] dark:hover:bg-canvas"
                onClick={() => shiftAnchor(1)}
                aria-label={t('postiz.calendar.nextMonth')}
              >
                <span aria-hidden="true">›</span>
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-full bg-[#f3f0fa] p-1 dark:bg-canvas">
              {(['month', 'week', 'day'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setExpandedDay(null)
                    setViewMode(mode)
                  }}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    viewMode === mode
                      ? 'bg-white text-[#5b3d8a] shadow-sm dark:bg-canvas-raised dark:text-accent-primary-deep'
                      : 'text-ink-muted'
                  }`}
                >
                  {t(`postiz.calendar.view.${mode}`)}
                </button>
              ))}
              <button
                ref={filterRef}
                type="button"
                aria-haspopup="menu"
                aria-expanded={filterOpen}
                aria-controls={filterOpen ? filterMenuId : undefined}
                aria-label={t('postiz.calendar.filterPosts')}
                onClick={() => setFilterOpen((current) => !current)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-white dark:hover:bg-canvas-raised"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
                  <path d="M4 7h16M7 12h10M10 17h4" />
                </svg>
              </button>
              <AnchoredMenu
                open={filterOpen}
                onClose={() => setFilterOpen(false)}
                triggerRef={filterRef}
                menuId={filterMenuId}
                label={t('postiz.calendar.filterPosts')}
              >
                {(['all', 'linkedin', 'x'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="menuitemradio"
                    aria-checked={platformFilter === option}
                    className={menuItemClassName()}
                    onClick={() => {
                      setPlatformFilter(option)
                      setFilterOpen(false)
                    }}
                  >
                    {t(`postiz.calendar.filter.${option}`)}
                  </button>
                ))}
              </AnchoredMenu>
            </div>
          </div>

          {error ? <p className="mt-4 text-sm text-[#C45C4A]">{error}</p> : null}

          {viewMode === 'day' ? (
            <div className="mt-4 space-y-2">
              {(postsByDay.get(dateKey(anchor)) ?? []).length === 0 && !loading ? (
                <p className="text-sm text-ink-muted">{t('postiz.calendar.noPostsThisDay')}</p>
              ) : null}
              {(postsByDay.get(dateKey(anchor)) ?? []).map((post) => (
                <PostEventChip
                  key={post.id}
                  isX={isXPost(post)}
                  title={`${t(calendarStatusKey(post.state, post.publish_date, nowMs))} · ${formatPostTime(post.publish_date, i18n.language)} · ${post.content}`}
                  label={t(calendarStatusKey(post.state, post.publish_date, nowMs))}
                  onOpen={() => openEdit(post)}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-2xl border border-border-hairline">
              <div className="grid grid-cols-7 border-b border-border-hairline">
                {weekdayLabels.map((label) => (
                  <div
                    key={label}
                    className="px-1 py-2.5 text-center text-[10px] font-semibold tracking-[0.08em] text-ink-muted sm:text-xs"
                  >
                    {label}
                  </div>
                ))}
              </div>
              <div className={`grid grid-cols-7 ${viewMode === 'week' ? 'min-h-[22rem]' : ''}`}>
                {monthCells.map((date, index) => {
                  const key = dateKey(date)
                  const dayPosts = postsByDay.get(key) ?? []
                  const isToday = key === dateKey(today)
                  const inMonth = viewMode === 'week' || date.getMonth() === anchor.getMonth()
                  const isLastCol = index % 7 === 6
                  const isLastRow = index >= monthCells.length - 7
                  const visiblePosts = expandedDay === key ? dayPosts : dayPosts.slice(0, 3)
                  return (
                    <div
                      key={key}
                      className={[
                        viewMode === 'week' ? 'min-h-[18rem] p-2' : 'min-h-[5.5rem] p-1.5 sm:min-h-[7rem] sm:p-2',
                        'bg-white dark:bg-canvas-raised',
                        !isLastCol ? 'border-r border-border-hairline' : '',
                        !isLastRow ? 'border-b border-border-hairline' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <button
                        type="button"
                        onClick={() => openCreate(date)}
                        className={
                          isToday
                            ? 'flex h-7 w-7 items-center justify-center rounded-full bg-[#7c5cbf] text-sm font-semibold text-white'
                            : inMonth
                              ? 'flex h-7 w-7 items-center justify-center text-sm font-medium text-ink'
                              : 'flex h-7 w-7 items-center justify-center text-sm text-ink-muted/60'
                        }
                      >
                        {date.getDate()}
                      </button>
                      <ul className="mt-1 space-y-1">
                        {visiblePosts.map((post) => (
                          <li key={post.id}>
                            <PostEventChip
                              isX={isXPost(post)}
                              title={`${t(calendarStatusKey(post.state, post.publish_date, nowMs))} · ${formatPostTime(post.publish_date, i18n.language)} · ${post.content}`}
                              label={t(calendarStatusKey(post.state, post.publish_date, nowMs))}
                              onOpen={() => openEdit(post)}
                            />
                          </li>
                        ))}
                        {dayPosts.length > 3 ? (
                          <li>
                            <button
                              type="button"
                              className="px-0.5 text-left text-[10px] text-ink-muted underline-offset-2 hover:underline"
                              onClick={() =>
                                setExpandedDay((current) => (current === key ? null : key))
                              }
                            >
                              {expandedDay === key
                                ? t('postiz.calendar.showLess')
                                : t('postiz.calendar.morePosts', { count: dayPosts.length - 3 })}
                            </button>
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {loading ? (
            <p className="mt-4 text-sm text-ink-muted">{t('postiz.calendar.loadingPosts')}</p>
          ) : null}
        </section>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/40 p-3 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="postiz-post-modal-title"
            className="flex max-h-[min(92dvh,calc(100vh-1.5rem))] w-full max-w-2xl flex-col overflow-hidden rounded-[1.5rem] border border-border-hairline bg-white shadow-[0_24px_64px_rgba(28,27,41,0.18)] dark:bg-canvas-raised dark:shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 sm:px-6 sm:pt-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {composerPlatform === 'x' ? (
                    <XMark className="h-10 w-10 shrink-0" />
                  ) : (
                    <LinkedInMark className="h-10 w-10 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <h3
                      id="postiz-post-modal-title"
                      className="font-serif text-2xl leading-none text-ink"
                    >
                      {modalMode === 'create'
                        ? composerPlatform === 'x'
                          ? t('postiz.calendar.x.createTitle')
                          : t('postiz.calendar.createPostTitle')
                        : modalMode === 'view'
                          ? t('postiz.calendar.x.viewTitle')
                          : composerPlatform === 'x'
                            ? t('postiz.calendar.x.editTitle')
                            : t('postiz.calendar.editPostTitle')}
                    </h3>
                    <p className="mt-2 text-sm text-ink-muted">
                      {t('postiz.calendar.mediaHint', {
                        max:
                          composerPlatform === 'x'
                            ? POSTIZ_MAX_X_POST_IMAGES
                            : POSTIZ_MAX_POST_IMAGES,
                      })}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={t('common.close')}
                  disabled={saving}
                  onClick={() => setModalOpen(false)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-[#f4effc] dark:hover:bg-canvas"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>

              {modalMode === 'create' ? (
                <fieldset className="mt-5">
                  <legend className="text-sm font-medium text-ink">
                    {t('postiz.calendar.composerPlatform')}
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-pressed={composerPlatform === 'linkedin'}
                      onClick={() => setComposerPlatform('linkedin')}
                      className={`flex min-w-[8.5rem] items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium text-ink ${
                        composerPlatform === 'linkedin'
                          ? 'border-[#c4b5fd] bg-[#f7f3ff] ring-1 ring-[#c4b5fd] dark:bg-[#2a2238]'
                          : 'border-border-hairline bg-white hover:bg-[#faf9fc] dark:bg-canvas dark:hover:bg-[#222126]'
                      }`}
                    >
                      <LinkedInMark className="h-8 w-8" />
                      {t('postiz.calendar.platformLinkedIn')}
                    </button>
                    <button
                      type="button"
                      aria-pressed={composerPlatform === 'x'}
                      onClick={() => setComposerPlatform('x')}
                      className={`flex min-w-[8.5rem] items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium text-ink ${
                        composerPlatform === 'x'
                          ? 'border-[#c4b5fd] bg-[#f7f3ff] ring-1 ring-[#c4b5fd] dark:bg-[#2a2238]'
                          : 'border-border-hairline bg-white hover:bg-[#faf9fc] dark:bg-canvas dark:hover:bg-[#222126]'
                      }`}
                    >
                      <XMark className="h-8 w-8" />
                      {t('postiz.calendar.platformX')}
                    </button>
                  </div>
                </fieldset>
              ) : null}

              {editingPost ? (
                <p className="mt-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      calendarStatusKey(editingPost.state, editingPost.publish_date, nowMs) ===
                      'postiz.calendar.stateNotPublished'
                        ? stateBadgeClass('ERROR')
                        : stateBadgeClass(editingPost.state)
                    }`}
                  >
                    {t(calendarStatusKey(editingPost.state, editingPost.publish_date, nowMs), {
                      state: editingPost.state,
                    })}
                  </span>
                </p>
              ) : null}

              {composerPlatform === 'x' && modalMode === 'create' ? (
                <div className="mt-5 space-y-4">
                  {xThreadEntries.map((entry, index) => (
                    <div key={entry.localId}>
                      <ComposerBox
                        id={`x-thread-${entry.localId}`}
                        label={
                          index === 0
                            ? t('postiz.calendar.contentHeading')
                            : t('postiz.calendar.x.threadPost', { number: index + 1 })
                        }
                        value={entry.content}
                        placeholder={t('postiz.calendar.contentPlaceholder')}
                        onChange={(next) =>
                          setXThreadEntries((current) =>
                            current.map((item) =>
                              item.localId === entry.localId ? { ...item, content: next } : item,
                            ),
                          )
                        }
                      />
                      {xThreadEntries.length > 1 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={saving || index === 0}
                            className="text-xs text-ink-muted disabled:opacity-40"
                            onClick={() =>
                              setXThreadEntries((current) => moveXThreadEntry(current, index, -1))
                            }
                          >
                            {t('postiz.calendar.moveUp')}
                          </button>
                          <button
                            type="button"
                            disabled={saving || index === xThreadEntries.length - 1}
                            className="text-xs text-ink-muted disabled:opacity-40"
                            onClick={() =>
                              setXThreadEntries((current) => moveXThreadEntry(current, index, 1))
                            }
                          >
                            {t('postiz.calendar.moveDown')}
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            className="text-xs text-red-700 disabled:opacity-40 dark:text-red-300"
                            onClick={() =>
                              setXThreadEntries((current) => removeXThreadEntry(current, index))
                            }
                          >
                            {t('postiz.calendar.x.removePost')}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  <button
                    type="button"
                    disabled={saving}
                    className={COMPOSER_SECONDARY_BTN}
                    onClick={() => setXThreadEntries((current) => addXThreadEntry(current))}
                  >
                    {t('postiz.calendar.x.addPost')}
                  </button>
                </div>
              ) : (
                <div className="mt-5">
                  <ComposerBox
                    id="postiz-post-content"
                    label={t('postiz.calendar.contentHeading')}
                    value={formContent}
                    readOnly={modalMode === 'view'}
                    maxLength={
                      modalMode === 'view' || composerPlatform === 'x'
                        ? undefined
                        : LINKEDIN_CONTENT_LIMIT
                    }
                    placeholder={t('postiz.calendar.contentPlaceholder')}
                    onChange={setFormContent}
                  />
                </div>
              )}

              <div className="mt-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-ink">{t('postiz.calendar.mediaLabel')}</p>
                  {composerPlatform === 'x' ? (
                    <p className="text-xs text-ink-muted">{t('postiz.calendar.x.threadMedia')}</p>
                  ) : null}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={MEDIA_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(event) => addFiles(event.target.files)}
                />
                {modalMode === 'view' ? null : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (
                        !saving &&
                        !isAddMediaDisabled(
                          attachments.map((item) => ({ kind: item.kind })),
                          composerMaxImages,
                        )
                      ) {
                        fileInputRef.current?.click()
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') {
                        return
                      }
                      event.preventDefault()
                      if (
                        saving ||
                        isAddMediaDisabled(
                          attachments.map((item) => ({ kind: item.kind })),
                          composerMaxImages,
                        )
                      ) {
                        return
                      }
                      fileInputRef.current?.click()
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (!saving) {
                        addFiles(event.dataTransfer.files)
                      }
                    }}
                    className="mt-3 flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-[#d9d0ea] bg-[#faf8ff] px-4 py-8 text-center dark:border-accent-primary/30 dark:bg-canvas"
                  >
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#ece4fb] text-[#5b3d8a] dark:bg-accent-primary-soft dark:text-accent-primary-deep">
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-6 w-6">
                        <rect x="3.5" y="5" width="17" height="14" rx="2" />
                        <circle cx="9" cy="10" r="1.4" />
                        <path d="m21 15-4.5-4.5L8 19" />
                      </svg>
                    </span>
                    <p className="mt-3 text-sm font-semibold text-ink">
                      {t('postiz.calendar.mediaDropTitle')}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">{t('postiz.calendar.mediaDropHint')}</p>
                    <p className="mt-2 text-xs text-ink-muted">
                      {t('postiz.calendar.mediaDropTypes', { max: composerMaxImages })}
                    </p>
                  </div>
                )}
                {attachments.length > 0 ? (
                  <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {attachments.map((item, index) => (
                      <li
                        key={item.localId}
                        className="overflow-hidden rounded-2xl border border-border-hairline bg-white dark:bg-canvas"
                      >
                        <div className="aspect-square bg-canvas">
                          {item.kind === 'video' ? (
                            <video
                              src={item.previewUrl}
                              controls
                              className="h-full w-full object-contain"
                              preload="metadata"
                            />
                          ) : (
                            <img
                              src={item.previewUrl}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          )}
                        </div>
                        <div className="space-y-0.5 px-2 pt-2">
                          {item.fileName ? (
                            <p className="truncate text-[11px] font-medium text-ink">{item.fileName}</p>
                          ) : null}
                          {item.fileSize != null ? (
                            <p className="text-[10px] text-ink-muted">{formatFileSize(item.fileSize)}</p>
                          ) : null}
                        </div>
                        {modalMode === 'view' ? null : (
                          <div className="flex flex-wrap items-center gap-1 p-2">
                            <button
                              type="button"
                              disabled={saving || index === 0}
                              className="rounded px-1.5 py-0.5 text-[11px] text-ink disabled:opacity-40"
                              onClick={() => moveAttachment(item.localId, -1)}
                            >
                              {t('postiz.calendar.moveUp')}
                            </button>
                            <button
                              type="button"
                              disabled={saving || index === attachments.length - 1}
                              className="rounded px-1.5 py-0.5 text-[11px] text-ink disabled:opacity-40"
                              onClick={() => moveAttachment(item.localId, 1)}
                            >
                              {t('postiz.calendar.moveDown')}
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              className="rounded px-1.5 py-0.5 text-[11px] text-red-600"
                              onClick={() => removeAttachment(item.localId)}
                            >
                              {t('postiz.calendar.removeImage')}
                            </button>
                          </div>
                        )}
                        <p className="px-2 pb-2 text-[11px] text-ink-muted">
                          {item.status === 'uploading'
                            ? t('postiz.calendar.mediaUploading')
                            : item.status === 'error'
                              ? item.error || t('postiz.calendar.mediaUploadFailed')
                              : item.status === 'ready'
                                ? t('postiz.calendar.mediaReady')
                                : t('postiz.calendar.mediaPending')}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : modalMode === 'view' ? (
                  <p className="mt-2 text-xs text-ink-muted">{t('postiz.calendar.mediaOptional')}</p>
                ) : null}
              </div>

              <label className="mt-5 block text-sm font-medium text-ink" htmlFor="postiz-post-when">
                {t('postiz.calendar.whenLabel')}
                <input
                  id="postiz-post-when"
                  type="datetime-local"
                  value={formWhen}
                  readOnly={modalMode === 'view'}
                  disabled={modalMode === 'view'}
                  onChange={(event) => setFormWhen(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-border-hairline bg-white px-3 py-2.5 text-sm text-ink disabled:opacity-90 dark:bg-canvas"
                />
              </label>
              <p className="mt-1 pb-2 text-xs text-ink-muted">{t('postiz.calendar.timezoneHint')}</p>

              {formError ? <p className="mt-3 pb-2 text-sm text-red-600">{formError}</p> : null}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border-hairline bg-white px-5 py-4 sm:px-6 dark:bg-canvas-raised">
              <button
                type="button"
                disabled={saving}
                className={COMPOSER_SECONDARY_BTN}
                onClick={() => setModalOpen(false)}
              >
                {modalMode === 'view' ? t('common.close') : t('common.cancel')}
              </button>
              <div className="flex flex-wrap justify-end gap-2">
                {modalMode === 'view' && editingPost?.state.toUpperCase() === 'ERROR' ? (
                  <button
                    type="button"
                    disabled={saving || deleting}
                    className={COMPOSER_SECONDARY_BTN}
                    onClick={() => setDeleteOpen(true)}
                  >
                    {t('common.delete')}
                  </button>
                ) : null}
                {modalMode === 'create' ? (
                  <>
                    <button
                      type="button"
                      disabled={saving || contentBlocksSave || mediaBlocksSave}
                      className={COMPOSER_SECONDARY_BTN}
                      onClick={() => void submitPost('draft')}
                    >
                      {t('postiz.calendar.saveDraft')}
                    </button>
                    <button
                      type="button"
                      disabled={saving || contentBlocksSave || !formWhen || mediaBlocksSave}
                      className={COMPOSER_SECONDARY_BTN}
                      onClick={() => void submitPost('schedule')}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
                        <rect x="3.5" y="5" width="17" height="15" rx="2" />
                        <path d="M8 3.5v3M16 3.5v3M3.5 10h17" />
                      </svg>
                      {t('postiz.calendar.schedule')}
                    </button>
                    <button
                      type="button"
                      disabled={saving || contentBlocksSave || mediaBlocksSave}
                      className={COMPOSER_PRIMARY_BTN}
                      onClick={() => void submitPost('now')}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
                        <path d="M21 3 10.5 13.5" />
                        <path d="m21 3-7 18-3.5-7.5L3 10z" />
                      </svg>
                      {t('postiz.calendar.publishNow')}
                    </button>
                  </>
                ) : modalMode === 'edit' && composerPlatform === 'x' ? (
                  <>
                    <button
                      type="button"
                      disabled={saving || deleting}
                      className={COMPOSER_SECONDARY_BTN}
                      onClick={() => setDeleteOpen(true)}
                    >
                      {t('common.delete')}
                    </button>
                    <button
                      type="button"
                      disabled={saving || !formContent.trim() || !formWhen || mediaBlocksSave}
                      className={COMPOSER_SECONDARY_BTN}
                      onClick={() => void submitUpdate()}
                    >
                      {t('postiz.calendar.saveChanges')}
                    </button>
                    <button
                      type="button"
                      disabled={saving || !formContent.trim() || mediaBlocksSave}
                      className={COMPOSER_PRIMARY_BTN}
                      onClick={() => void submitPublishNowExisting()}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
                        <path d="M21 3 10.5 13.5" />
                        <path d="m21 3-7 18-3.5-7.5L3 10z" />
                      </svg>
                      {t('postiz.calendar.publishNow')}
                    </button>
                  </>
                ) : modalMode === 'edit' ? (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      className={COMPOSER_SECONDARY_BTN}
                      onClick={() => void submitStatus('schedule')}
                    >
                      {t('postiz.calendar.markScheduled')}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      className={COMPOSER_SECONDARY_BTN}
                      onClick={() => void submitStatus('draft')}
                    >
                      {t('postiz.calendar.markDraft')}
                    </button>
                    <button
                      type="button"
                      disabled={saving || deleting}
                      className={COMPOSER_SECONDARY_BTN}
                      onClick={() => setDeleteOpen(true)}
                    >
                      {t('common.delete')}
                    </button>
                    <button
                      type="button"
                      disabled={saving || !formContent.trim() || !formWhen || mediaBlocksSave}
                      className={COMPOSER_SECONDARY_BTN}
                      onClick={() => void submitUpdate()}
                    >
                      {t('postiz.calendar.saveChanges')}
                    </button>
                    <button
                      type="button"
                      disabled={saving || !formContent.trim() || mediaBlocksSave}
                      className={COMPOSER_PRIMARY_BTN}
                      onClick={() => void submitPublishNowExisting()}
                    >
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4">
                        <path d="M21 3 10.5 13.5" />
                        <path d="m21 3-7 18-3.5-7.5L3 10z" />
                      </svg>
                      {t('postiz.calendar.publishNow')}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={deleteOpen}
        title={t('postiz.calendar.deleteTitle')}
        description={t('postiz.calendar.deleteBody')}
        confirmLabel={t('common.delete')}
        confirming={deleting}
        tone="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => {
          if (!deleting) {
            setDeleteOpen(false)
          }
        }}
      />
    </>
  )
}
