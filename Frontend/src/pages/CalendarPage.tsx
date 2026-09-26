import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { OverviewWorkspaceHeader } from '../components/dashboard/OverviewWorkspaceHeader'
import { useDashboardShell } from '../hooks/useDashboardShell'
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
  monthBoundsAsOffsetIso,
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

type PostModalMode = 'create' | 'edit'

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
const CALENDAR_CHIP_BTN =
  'inline-flex items-center gap-1.5 rounded-xl border border-btn-secondary-border bg-canvas-raised px-3 py-2 text-sm font-medium text-accent-primary-deep transition-all duration-200 hover:-translate-y-px hover:border-accent-primary/40 hover:bg-btn-secondary-hover hover:shadow-[0_4px_12px_rgba(23,21,37,0.06)] dark:hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)]'
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

function pastelEventChipClass(state: string): string {
  switch (state.toUpperCase()) {
    case 'PUBLISHED':
      return 'bg-[#EAF8F1] border-[#C8E8D8]/70 dark:bg-signal-positive-soft dark:border-signal-positive/30'
    case 'QUEUE':
      return 'bg-accent-primary-soft border-[#D4C4F5]/60 dark:bg-accent-primary-soft dark:border-accent-primary/30'
    case 'DRAFT':
      return 'bg-[#FFF0EA] border-[#F0D8CC]/70 dark:bg-[#2a221c] dark:border-[#4a3830]'
    case 'ERROR':
      return 'bg-[#FFF0EA] border-[#F0C8BC]/80 dark:bg-red-950/40 dark:border-red-900/50'
    default:
      return 'bg-[#EAF2FF] border-[#D0DCF0]/70 dark:bg-[#1a2230] dark:border-[#2a3548]'
  }
}

function pastelDotClass(state: string): string {
  switch (state.toUpperCase()) {
    case 'PUBLISHED':
      return 'bg-[#3D9B6E]'
    case 'QUEUE':
      return 'bg-[#7C4DCC]'
    case 'DRAFT':
      return 'bg-[#D4A574]'
    case 'ERROR':
      return 'bg-[#C45C4A]'
    default:
      return 'bg-[#6B8CC7]'
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
      mainClassName="overflow-y-auto px-4 pb-8 pt-4 sm:px-8 sm:pt-6"
    >
      <OverviewWorkspaceHeader
        title={t('placeholder.calendar.title')}
        subtitle={t('placeholder.calendar.subtitle')}
        className="mb-6 sm:mb-8 [&_h1]:text-[2rem] [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-ink sm:[&_h1]:text-[2.25rem] [&_p]:text-ink-muted"
      />

      {avatarId ? (
        <CalendarPostizPanel key={avatarId} avatarId={avatarId} />
      ) : (
        <section className={`${CALENDAR_CARD} p-8 sm:p-10`}>
          <p className="text-sm text-ink-muted">{t('postiz.calendar.checking')}</p>
        </section>
      )}
    </DashboardLayout>
  )
}

function XChannelPanel({
  avatarId,
  onIntegrationChange,
}: {
  avatarId: string
  onIntegrationChange: (integration: PostizIntegration | null) => void
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
  const [disconnectWarning, setDisconnectWarning] = useState<string | null>(null)
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
        setErrorMessage(
          error instanceof PostizApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : t('postiz.calendar.x.statusFailed'),
        )
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
      setErrorMessage(
        error instanceof PostizApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : t('postiz.calendar.x.claimFailed'),
      )
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
            setErrorMessage(
              error instanceof PostizApiError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : t('postiz.calendar.x.timeout'),
            )
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
      setErrorMessage(
        error instanceof PostizApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : t('postiz.calendar.x.connectFailed'),
      )
    }
  }

  async function handleDisconnectConfirm() {
    setIsDisconnecting(true)
    setErrorMessage(null)
    try {
      const result = await disconnectPostizIntegration(avatarId, 'x')
      setDisconnectOpen(false)
      setDisconnectWarning(result.warning)
      setIntegration(null)
      setUiState('disconnected')
    } catch (error) {
      setErrorMessage(
        error instanceof PostizApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : t('postiz.calendar.x.disconnectFailed'),
      )
    } finally {
      setIsDisconnecting(false)
    }
  }

  return (
    <section className={`${CALENDAR_CARD} px-5 py-4 sm:px-6 sm:py-5`}>
      {disconnectWarning ? (
        <p role="status" className="mb-3 text-sm text-amber-950 dark:text-amber-100">
          {disconnectWarning}
        </p>
      ) : null}

      {uiState === 'checking' && (
        <p className="text-sm text-ink-muted">{t('postiz.calendar.x.checking')}</p>
      )}

      {uiState === 'disconnected' && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            {t('postiz.calendar.x.connectedEyebrow')}
          </p>
          <h2 className="mt-1 text-base font-semibold text-ink">{t('postiz.calendar.x.connectTitle')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {t('postiz.calendar.x.connectBody')}
          </p>
          <button
            type="button"
            onClick={() => setConnectPrepOpen(true)}
            className={`${CALENDAR_CREATE_BTN} mt-4 w-auto px-5`}
          >
            {t('postiz.calendar.x.connect')}
          </button>
        </div>
      )}

      {uiState === 'connecting' && (
        <div>
          <h2 className="text-base font-semibold text-ink">{t('postiz.calendar.x.connectingTitle')}</h2>
          <p className="mt-2 text-sm text-ink-muted">{t('postiz.calendar.x.connectingBody')}</p>
        </div>
      )}

      {uiState === 'choose_account' && (
        <div>
          <h2 className="text-base font-semibold text-ink">{t('postiz.calendar.x.chooseTitle')}</h2>
          <p className="mt-2 text-sm text-ink-muted">{t('postiz.calendar.x.chooseBody')}</p>
          <ul className="mt-4 space-y-3">
            {claimCandidates.map((candidate) => (
              <li
                key={candidate.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-hairline bg-canvas px-3 py-2"
              >
                <span className="text-sm font-medium text-ink">{candidate.name}</span>
                <button
                  type="button"
                  disabled={isClaiming}
                  onClick={() => void handleClaimAccount(candidate)}
                  className={`${CALENDAR_CREATE_BTN} w-auto px-4 py-2`}
                >
                  {t('postiz.calendar.useThisAccount')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {uiState === 'connected' && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            {integration?.picture ? (
              <img
                src={integration.picture}
                alt=""
                className="h-11 w-11 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <XMark className="h-11 w-11 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                {t('postiz.calendar.x.connectedEyebrow')}
              </p>
              <h2 className="mt-0.5 truncate text-base font-semibold text-ink">
                {t('postiz.calendar.x.connectedTitle')}
              </h2>
              <p className="mt-0.5 truncate text-sm text-ink-muted">
                {integration
                  ? t('postiz.calendar.x.connectedAs', { name: integration.name })
                  : t('postiz.calendar.x.connected')}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDisconnectOpen(true)} className={CALENDAR_CHIP_BTN}>
              {t('postiz.calendar.x.disconnect')}
            </button>
          </div>
        </div>
      )}

      {uiState === 'error' && (
        <div>
          <h2 className="text-base font-semibold text-ink">{t('postiz.calendar.x.errorTitle')}</h2>
          <p className="mt-2 text-sm text-[#C45C4A]">
            {errorMessage ?? t('postiz.calendar.x.connectFailed')}
          </p>
          <button
            type="button"
            onClick={() => setConnectPrepOpen(true)}
            className={`${CALENDAR_CREATE_BTN} mt-4 w-auto px-5`}
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={connectPrepOpen}
        title={t('postiz.calendar.x.connectPrepTitle')}
        description={t('postiz.calendar.x.connectPrepBody')}
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
    </section>
  )
}

function CalendarPostizPanel({ avatarId }: { avatarId: string }) {
  const { t } = useTranslation()
  const [uiState, setUiState] = useState<ConnectionUiState>('checking')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [integration, setIntegration] = useState<PostizIntegration | null>(null)
  const [claimCandidates, setClaimCandidates] = useState<PostizIntegration[]>([])
  const [isClaiming, setIsClaiming] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [connectPrepOpen, setConnectPrepOpen] = useState(false)
  const [disconnectWarning, setDisconnectWarning] = useState<string | null>(null)
  const [xIntegration, setXIntegration] = useState<PostizIntegration | null>(null)
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
      linkedinConnectingRef.current = false
      setClaimCandidates(candidates)
      setUiState('choose_account')
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
        setErrorMessage(
          error instanceof PostizApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : t('postiz.calendar.statusFailed'),
        )
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
    if (status.claim_candidates.length > 0) {
      applyClaimCandidates(status.claim_candidates)
      return false
    }
    setIntegration(null)
    return false
  }, [applyClaimCandidates, applyConnected, avatarId])

  async function handleClaimAccount(candidate: PostizIntegration) {
    setIsClaiming(true)
    setErrorMessage(null)
    try {
      const result = await claimPostizIntegration(avatarId, candidate.id)
      if (!result.connected || result.integration === null) {
        throw new PostizApiError(t('postiz.calendar.claimFailed'))
      }
      applyConnected(result.integration)
    } catch (error) {
      setUiState('error')
      setErrorMessage(
        error instanceof PostizApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : t('postiz.calendar.claimFailed'),
      )
    } finally {
      setIsClaiming(false)
    }
  }

  async function loadInitialStatus() {
    setUiState('checking')
    setErrorMessage(null)
    try {
      const status = await getPostizStatus(avatarId)
      if (status.connected) {
        applyConnected(status.integration)
        return
      }
      if (status.claim_candidates.length > 0) {
        applyClaimCandidates(status.claim_candidates)
        return
      }
      setIntegration(null)
      setClaimCandidates([])
      setUiState('disconnected')
    } catch (error) {
      setUiState('error')
      setErrorMessage(
        error instanceof PostizApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : t('postiz.calendar.statusFailed'),
      )
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
            if (status.claim_candidates.length > 0) {
              applyClaimCandidates(status.claim_candidates)
              return
            }
            setUiState('error')
            setErrorMessage(t('postiz.calendar.timeout'))
          } catch (error) {
            setUiState('error')
            setErrorMessage(
              error instanceof PostizApiError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : t('postiz.calendar.timeout'),
            )
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
  }, [
    applyClaimCandidates,
    applyConnected,
    avatarId,
    closePopup,
    refreshStatus,
    stopPolling,
    t,
  ])

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
      setErrorMessage(
        error instanceof PostizApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : t('postiz.calendar.connectFailed'),
      )
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
      setErrorMessage(
        error instanceof PostizApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : t('postiz.calendar.disconnectFailed'),
      )
    } finally {
      setIsDisconnecting(false)
    }
  }

  return (
    <>
      {disconnectWarning ? (
        <div
          role="status"
          className="mb-4 rounded-[1.25rem] border border-amber-200 bg-[#FFF7F3] px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100"
        >
          {disconnectWarning}
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="min-w-0">
      {uiState === 'checking' && (
        <section className={`${CALENDAR_CARD} p-8 sm:p-10`}>
          <p className="text-sm text-ink-muted">{t('postiz.calendar.checking')}</p>
        </section>
      )}

      {uiState === 'disconnected' && (
        <section className={`${CALENDAR_CARD} p-8 sm:p-10`}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-primary-deep">
            {t('postiz.calendar.connectEyebrow')}
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
            {t('postiz.calendar.connectTitle')}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
            {t('postiz.calendar.connectBody')}
          </p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
            {t('postiz.calendar.switchAccountHint')}
          </p>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
            {t('postiz.calendar.switchAccountDetail')}
          </p>
          <button
            type="button"
            onClick={requestConnectLinkedIn}
            className={`${CALENDAR_CREATE_BTN} mt-6 w-auto px-5`}
          >
            {t('postiz.calendar.connectLinkedIn')}
          </button>
        </section>
      )}

      {uiState === 'connecting' && (
        <section className={`${CALENDAR_CARD} p-8 sm:p-10`}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-primary-deep">
            {t('postiz.calendar.connectingEyebrow')}
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
            {t('postiz.calendar.connectingTitle')}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
            {t('postiz.calendar.connectingBody')}
          </p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
            {t('postiz.calendar.switchAccountHint')}
          </p>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
            {t('postiz.calendar.switchAccountDetail')}
          </p>
        </section>
      )}

      {uiState === 'choose_account' && (
        <section className={`${CALENDAR_CARD} p-8 sm:p-10`}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-primary-deep">
            {t('postiz.calendar.chooseEyebrow')}
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
            {t('postiz.calendar.chooseTitle')}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
            {t('postiz.calendar.chooseBody')}
          </p>
          <ul className="mt-6 space-y-3">
            {claimCandidates.map((candidate) => (
              <li
                key={candidate.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border-hairline bg-canvas px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  {candidate.picture ? (
                    <img
                      src={candidate.picture}
                      alt=""
                      className="h-10 w-10 rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary-soft text-sm font-semibold text-accent-primary-deep">
                      {candidate.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm font-medium text-ink">{candidate.name}</span>
                </div>
                <button
                  type="button"
                  disabled={isClaiming}
                  onClick={() => void handleClaimAccount(candidate)}
                  className={`${CALENDAR_CREATE_BTN} w-auto px-4 py-2.5`}
                >
                  {t('postiz.calendar.useThisAccount')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {uiState === 'connected' && (
        <div className="space-y-5 sm:space-y-6">
          <section className={`${CALENDAR_CARD} px-5 py-4 sm:px-6 sm:py-5`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                {integration?.picture ? (
                  <img
                    src={integration.picture}
                    alt=""
                    className="h-11 w-11 shrink-0 rounded-xl object-cover"
                  />
                ) : (
                  <LinkedInMark className="h-11 w-11 shrink-0" />
                )}
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                    {t('postiz.calendar.connectedEyebrow')}
                  </p>
                  <h2 className="mt-0.5 truncate text-base font-semibold text-ink sm:text-lg">
                    {t('postiz.calendar.connectedTitle')}
                  </h2>
                  <p className="mt-0.5 truncate text-sm text-ink-muted">
                    {integration
                      ? t('postiz.calendar.linkedinConnectedAs', {
                          name: integration.name,
                        })
                      : t('postiz.calendar.linkedinConnected')}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EAF8F1] px-2.5 py-1 text-xs font-medium text-[#1A5C3A] dark:bg-signal-positive-soft dark:text-signal-positive">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1fa97e] dark:bg-signal-positive" aria-hidden="true" />
                  {t('postiz.calendar.connectedStatus')}
                </span>
                <button
                  type="button"
                  onClick={() => void loadInitialStatus()}
                  className={CALENDAR_CHIP_BTN}
                >
                  {t('postiz.calendar.refreshStatus')}
                </button>
                <button
                  type="button"
                  onClick={requestConnectLinkedIn}
                  className={CALENDAR_CHIP_BTN}
                >
                  {t('postiz.calendar.reconnectLinkedIn')}
                </button>
                <button
                  type="button"
                  onClick={() => setDisconnectOpen(true)}
                  className={CALENDAR_CHIP_BTN}
                >
                  {t('postiz.calendar.disconnectLinkedIn')}
                </button>
              </div>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-muted sm:text-sm">
              {t('postiz.calendar.reconnectSwitchHint')}
            </p>
          </section>
        </div>
      )}

      {uiState === 'error' && (
        <section className={`${CALENDAR_CARD} p-8 sm:p-10`}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#C45C4A]">
            {t('postiz.calendar.errorEyebrow')}
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
            {t('postiz.calendar.errorTitle')}
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#C45C4A]">
            {errorMessage ?? t('postiz.calendar.connectFailed')}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={requestConnectLinkedIn}
              className={`${CALENDAR_CREATE_BTN} w-auto px-5`}
            >
              {t('common.retry')}
            </button>
            <button
              type="button"
              onClick={() => void loadInitialStatus()}
              className={CALENDAR_CHIP_BTN}
            >
              {t('postiz.calendar.refreshStatus')}
            </button>
          </div>
        </section>
      )}
        </div>
        <XChannelPanel avatarId={avatarId} onIntegrationChange={setXIntegration} />
      </div>

      {uiState === 'connected' || xIntegration ? (
        <div className="mt-5">
          <AvatarCalendarBoard
            avatarId={avatarId}
            xIntegrationId={xIntegration?.id ?? null}
          />
        </div>
      ) : null}

      <ConfirmDialog
        open={connectPrepOpen}
        title={t('postiz.calendar.connectPrepTitle')}
        description={t('postiz.calendar.connectPrepBody')}
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
}: {
  avatarId: string
  xIntegrationId: string | null
}) {
  const { t, i18n } = useTranslation()
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth())
  const [posts, setPosts] = useState<PostizCalendarPost[]>([])
  const [loading, setLoading] = useState(true)
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

  useEffect(() => {
    let cancelled = false

    async function fetchPosts() {
      try {
        const { startDate, endDate } = monthBoundsAsOffsetIso(viewYear, viewMonth)
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
        setError(
          err instanceof PostizApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : t('postiz.calendar.postsLoadFailed'),
        )
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
  }, [avatarId, reloadToken, t, viewMonth, viewYear])

  function beginPostsReload() {
    setLoading(true)
    setError(null)
    setPosts([])
    setReloadToken((value) => value + 1)
  }

  function goToPreviousMonth() {
    setLoading(true)
    setError(null)
    setPosts([])
    if (viewMonth === 0) {
      setViewYear((year) => year - 1)
      setViewMonth(11)
    } else {
      setViewMonth((month) => month - 1)
    }
  }

  function goToNextMonth() {
    setLoading(true)
    setError(null)
    setPosts([])
    if (viewMonth === 11) {
      setViewYear((year) => year + 1)
      setViewMonth(0)
    } else {
      setViewMonth((month) => month + 1)
    }
  }

  const postsByDay = useMemo(() => {
    const map = new Map<number, PostizCalendarPost[]>()
    for (const post of posts) {
      const d = new Date(post.publish_date)
      if (Number.isNaN(d.getTime())) {
        continue
      }
      if (d.getFullYear() !== viewYear || d.getMonth() !== viewMonth) {
        continue
      }
      const day = d.getDate()
      const list = map.get(day) ?? []
      list.push(post)
      map.set(day, list)
    }
    return map
  }, [posts, viewMonth, viewYear])

  const monthLabel = useMemo(() => {
    return new Intl.DateTimeFormat(i18n.language || 'en', {
      month: 'long',
      year: 'numeric',
    }).format(new Date(viewYear, viewMonth, 1))
  }, [i18n.language, viewMonth, viewYear])

  const upcomingPosts = useMemo(() => {
    return [...posts].sort(
      (a, b) => new Date(a.publish_date).getTime() - new Date(b.publish_date).getTime(),
    )
  }, [posts])

  const today = useMemo(() => {
    const d = new Date()
    return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() }
  }, [])

  const calendarCells = useMemo(() => {
    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay()
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const cells: Array<{ day: number | null }> = []
    for (let i = 0; i < firstWeekday; i += 1) {
      cells.push({ day: null })
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push({ day })
    }
    while (cells.length % 7 !== 0) {
      cells.push({ day: null })
    }
    return cells
  }, [viewMonth, viewYear])

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

  function openCreate(day?: number) {
    setModalMode('create')
    setEditingPost(null)
    setComposerPlatform('linkedin')
    setFormContent('')
    setFormError(null)
    clearAttachments()
    const pad = (n: number) => String(n).padStart(2, '0')
    const base =
      day != null
        ? new Date(viewYear, viewMonth, day, 9, 0)
        : new Date(Date.now() + 60 * 60 * 1000)
    setFormWhen(
      `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(base.getHours())}:${pad(base.getMinutes())}`,
    )
    setModalOpen(true)
  }

  function isXPost(post: PostizCalendarPost): boolean {
    return xIntegrationId != null && post.integration_id === xIntegrationId
  }

  function openEdit(post: PostizCalendarPost) {
    if (isXPost(post)) {
      return
    }
    setComposerPlatform('linkedin')
    setModalMode('edit')
    setEditingPost(post)
    setFormContent(post.content)
    setFormWhen(isoToLocalDateTimeInput(post.publish_date))
    setFormError(null)
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
    setModalOpen(true)
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
        err instanceof PostizApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('postiz.calendar.mediaUploadFailed'),
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
      await createPostizPost({
        avatarId,
        type,
        content: formContent,
        publishDate,
        images,
        ...(composerPlatform === 'x' ? { platform: 'x' as const } : {}),
      })
      setModalOpen(false)
      clearAttachments()
      beginPostsReload()
    } catch (err) {
      setFormError(
        err instanceof PostizApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('postiz.calendar.saveFailed'),
      )
    } finally {
      setSaving(false)
    }
  }

  async function submitUpdate() {
    if (!editingPost) {
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      // Complete final image array (including [] if all removed).
      const images = await resolveFinalImages()
      await createPostizPost({
        avatarId,
        type: 'update',
        content: formContent,
        publishDate: localDateTimeToOffsetIso(formWhen),
        postId: editingPost.id,
        images,
      })
      setModalOpen(false)
      clearAttachments()
      beginPostsReload()
    } catch (err) {
      setFormError(
        err instanceof PostizApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('postiz.calendar.saveFailed'),
      )
    } finally {
      setSaving(false)
    }
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
      setFormError(
        err instanceof PostizApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('postiz.calendar.saveFailed'),
      )
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!editingPost) {
      return
    }
    setDeleting(true)
    try {
      await deletePostizPost(avatarId, editingPost.id)
      setDeleteOpen(false)
      setModalOpen(false)
      setEditingPost(null)
      beginPostsReload()
    } catch (err) {
      setFormError(
        err instanceof PostizApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('postiz.calendar.deleteFailed'),
      )
    } finally {
      setDeleting(false)
    }
  }

  const weekdayLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(i18n.language || 'en', {
      weekday: 'short',
    })
    return Array.from({ length: 7 }, (_, index) =>
      formatter.format(new Date(2024, 0, index)),
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

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
      <aside className={`${CALENDAR_CARD} w-full shrink-0 p-4 sm:p-5 lg:w-[17.5rem]`}>
        <button
          type="button"
          className={CALENDAR_CREATE_BTN}
          onClick={() => openCreate()}
        >
          <span aria-hidden="true">+</span>
          {t('postiz.calendar.createPost')}
        </button>

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-ink">
            {t('postiz.calendar.upcomingThisMonth')}
          </h3>
          {loading ? (
            <p className="mt-3 text-sm text-ink-muted">{t('postiz.calendar.loadingPosts')}</p>
          ) : null}
          {!loading && upcomingPosts.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">{t('postiz.calendar.noUpcomingPosts')}</p>
          ) : null}
          <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-0.5">
            {upcomingPosts.map((post) => (
              <li key={post.id}>
                <button
                  type="button"
                  onClick={() => openEdit(post)}
                  title={
                    isXPost(post) ? t('postiz.calendar.x.noEdit') : undefined
                  }
                  className="group w-full rounded-2xl border border-border-hairline bg-canvas px-3 py-2.5 text-left transition-all duration-200 hover:-translate-y-px hover:border-[rgba(90,60,130,0.2)] hover:bg-canvas-raised hover:shadow-[0_4px_12px_rgba(23,21,37,0.05)]"
                >
                  <p className="text-[11px] font-medium text-ink-muted">
                    {isXPost(post) ? `${t('postiz.calendar.platformX')} · ` : ''}
                    {formatPostDateTime(post.publish_date, i18n.language)}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm font-medium text-ink">
                    {post.content.slice(0, 80) || t('postiz.calendar.untitledPost')}
                  </p>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-muted">
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${pastelDotClass(post.state)}`}
                      aria-hidden="true"
                    />
                    {t(stateLabelKey(post.state), { state: post.state })}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <section className={`${CALENDAR_CARD} min-w-0 flex-1 p-4 sm:p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold tracking-tight text-ink sm:text-xl">
            {monthLabel}
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`${CALENDAR_CHIP_BTN} px-2.5`}
              onClick={goToPreviousMonth}
              aria-label={t('postiz.calendar.prevMonth')}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              className={`${CALENDAR_CHIP_BTN} px-2.5`}
              onClick={goToNextMonth}
              aria-label={t('postiz.calendar.nextMonth')}
            >
              <span aria-hidden="true">›</span>
            </button>
          </div>
        </div>

        {error ? <p className="mt-4 text-sm text-[#C45C4A]">{error}</p> : null}

        <div className="mt-4 overflow-hidden rounded-2xl border border-border-hairline">
          <div className="grid grid-cols-7 border-b border-border-hairline bg-canvas">
            {weekdayLabels.map((label) => (
              <div
                key={label}
                className="px-1 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted sm:text-xs"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarCells.map((cell, index) => {
              const dayPosts = cell.day != null ? (postsByDay.get(cell.day) ?? []) : []
              const isToday =
                cell.day != null &&
                viewYear === today.year &&
                viewMonth === today.month &&
                cell.day === today.day
              const isLastCol = index % 7 === 6
              const isLastRow = index >= calendarCells.length - 7
              return (
                <div
                  key={`${viewYear}-${viewMonth}-${index}`}
                  className={[
                    'min-h-[5.5rem] p-1.5 transition-colors duration-200 sm:min-h-[7rem] sm:p-2',
                    cell.day != null ? 'bg-canvas-raised hover:bg-accent-primary-soft/40' : 'bg-canvas',
                    isToday ? 'bg-accent-primary-soft hover:bg-accent-primary-soft/60' : '',
                    !isLastCol ? 'border-r border-border-hairline' : '',
                    !isLastRow ? 'border-b border-border-hairline' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {cell.day != null ? (
                    <>
                      <button
                        type="button"
                        className={[
                          'flex h-7 w-7 items-center justify-center text-sm font-medium transition-colors duration-200',
                          isToday
                            ? 'rounded-full bg-[#7C4DCC] text-white dark:bg-accent-primary dark:text-btn-primary-fg'
                            : 'rounded-full text-ink hover:bg-accent-primary-soft hover:text-accent-primary-deep',
                        ].join(' ')}
                        onClick={() => openCreate(cell.day ?? undefined)}
                      >
                        {cell.day}
                      </button>
                      <ul className="mt-1 space-y-1">
                        {dayPosts.slice(0, 3).map((post) => {
                          const timeLabel = formatPostTime(post.publish_date, i18n.language)
                          return (
                            <li key={post.id}>
                              <button
                                type="button"
                                onClick={() => openEdit(post)}
                                className={`block w-full rounded-lg border px-1.5 py-1 text-left transition-all duration-150 hover:-translate-y-px hover:shadow-[0_2px_8px_rgba(23,21,37,0.06)] ${pastelEventChipClass(post.state)}`}
                                title={
                                  isXPost(post)
                                    ? t('postiz.calendar.x.noEdit')
                                    : post.content
                                }
                              >
                                <span className="flex items-center gap-1 text-[10px] font-medium text-ink sm:text-[11px]">
                                  <span
                                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${pastelDotClass(post.state)}`}
                                    aria-hidden="true"
                                  />
                                  {isXPost(post) ? `${t('postiz.calendar.platformX')} · ` : ''}
                                  {timeLabel}
                                </span>
                                <span className="mt-0.5 block truncate text-[10px] text-ink sm:text-[11px]">
                                  {post.content.slice(0, 40)}
                                </span>
                              </button>
                            </li>
                          )
                        })}
                        {dayPosts.length > 3 ? (
                          <li className="px-0.5 text-[10px] text-ink-muted">
                            {t('postiz.calendar.morePosts', { count: dayPosts.length - 3 })}
                          </li>
                        ) : null}
                      </ul>
                    </>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-ink-muted">{t('postiz.calendar.loadingPosts')}</p>
        ) : null}
      </section>

      {modalOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center overflow-y-auto bg-black/40 p-3 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="postiz-post-modal-title"
            className="flex max-h-[min(92dvh,calc(100vh-1.5rem))] w-full max-w-lg flex-col overflow-hidden rounded-[1.5rem] border border-border-hairline bg-canvas-raised shadow-[0_16px_48px_rgba(23,21,37,0.12)] dark:shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
          >
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 sm:px-6 sm:pt-6">
              <h3
                id="postiz-post-modal-title"
                className="text-2xl font-semibold tracking-tight text-ink"
              >
                {modalMode === 'create'
                  ? composerPlatform === 'x'
                    ? t('postiz.calendar.x.createTitle')
                    : t('postiz.calendar.createPostTitle')
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

              {modalMode === 'create' ? (
                <fieldset className="mt-4">
                  <legend className="text-sm font-medium text-ink">
                    {t('postiz.calendar.composerPlatform')}
                  </legend>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className={
                        composerPlatform === 'linkedin'
                          ? 'contos-btn contos-btn--rect contos-btn--primary text-xs'
                          : 'contos-btn contos-btn--rect contos-btn--secondary text-xs'
                      }
                      onClick={() => setComposerPlatform('linkedin')}
                    >
                      {t('postiz.calendar.platformLinkedIn')}
                    </button>
                    <button
                      type="button"
                      className={
                        composerPlatform === 'x'
                          ? 'contos-btn contos-btn--rect contos-btn--primary text-xs'
                          : 'contos-btn contos-btn--rect contos-btn--secondary text-xs'
                      }
                      onClick={() => setComposerPlatform('x')}
                    >
                      {t('postiz.calendar.platformX')}
                    </button>
                  </div>
                </fieldset>
              ) : null}

              {editingPost ? (
                <p className="mt-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${stateBadgeClass(editingPost.state)}`}
                  >
                    {t(stateLabelKey(editingPost.state), { state: editingPost.state })}
                  </span>
                </p>
              ) : null}

              <label className="mt-4 block text-sm font-medium text-ink">
                {t('postiz.calendar.contentLabel')}
                <textarea
                  value={formContent}
                  onChange={(event) => setFormContent(event.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-2xl border border-border-hairline bg-canvas px-3 py-2 text-sm text-ink"
                  maxLength={composerPlatform === 'x' ? undefined : 3000}
                />
                {composerPlatform === 'x' ? (
                  <span className="mt-1 block text-xs text-ink-muted">
                    {t('postiz.calendar.x.charCount', {
                      count: postizContentLength(formContent),
                    })}
                  </span>
                ) : null}
              </label>

              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink">
                    {t('postiz.calendar.attachMedia')}
                  </p>
                  <button
                    type="button"
                    disabled={
                      saving ||
                      isAddMediaDisabled(
                        attachments.map((item) => ({ kind: item.kind })),
                        composerPlatform === 'x'
                          ? POSTIZ_MAX_X_POST_IMAGES
                          : POSTIZ_MAX_POST_IMAGES,
                      )
                    }
                    className="contos-btn contos-btn--rect contos-btn--secondary text-xs"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {t('postiz.calendar.addMedia')}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={MEDIA_ACCEPT}
                    multiple
                    className="hidden"
                    onChange={(event) => addFiles(event.target.files)}
                  />
                </div>
                {attachments.length > 0 ? (
                  <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {attachments.map((item, index) => (
                      <li
                        key={item.localId}
                        className="overflow-hidden rounded-2xl border border-border-hairline bg-canvas-raised"
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
                            <p className="truncate text-[11px] font-medium text-ink">
                              {item.fileName}
                            </p>
                          ) : null}
                          {item.fileSize != null ? (
                            <p className="text-[10px] text-ink-muted">
                              {formatFileSize(item.fileSize)}
                            </p>
                          ) : null}
                        </div>
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
                ) : (
                  <p className="mt-2 text-xs text-ink-muted">
                    {t('postiz.calendar.mediaOptional')}
                  </p>
                )}
              </div>

              <label className="mt-4 block text-sm font-medium text-ink">
                {t('postiz.calendar.whenLabel')}
                <input
                  type="datetime-local"
                  value={formWhen}
                  onChange={(event) => setFormWhen(event.target.value)}
                  className="mt-1 w-full rounded-2xl border border-border-hairline bg-canvas px-3 py-2 text-sm text-ink"
                />
              </label>
              <p className="mt-1 pb-2 text-xs text-ink-muted">
                {t('postiz.calendar.timezoneHint')}
              </p>

              {formError ? <p className="mt-3 pb-2 text-sm text-red-600">{formError}</p> : null}
            </div>

            <div className="flex shrink-0 flex-wrap gap-2 border-t border-border-hairline bg-canvas-raised px-5 py-4 sm:px-6">
              {modalMode === 'create' ? (
                <>
                  <button
                    type="button"
                    disabled={saving || !formContent.trim() || mediaBlocksSave}
                    className="contos-btn contos-btn--rect contos-btn--primary"
                    onClick={() => void submitPost('now')}
                  >
                    {t('postiz.calendar.publishNow')}
                  </button>
                  <button
                    type="button"
                    disabled={
                      saving ||
                      !formContent.trim() ||
                      !formWhen ||
                      mediaBlocksSave
                    }
                    className="contos-btn contos-btn--rect contos-btn--secondary"
                    onClick={() => void submitPost('schedule')}
                  >
                    {t('postiz.calendar.schedule')}
                  </button>
                  <button
                    type="button"
                    disabled={saving || !formContent.trim() || mediaBlocksSave}
                    className="contos-btn contos-btn--rect contos-btn--secondary"
                    onClick={() => void submitPost('draft')}
                  >
                    {t('postiz.calendar.saveDraft')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={
                      saving ||
                      !formContent.trim() ||
                      !formWhen ||
                      mediaBlocksSave
                    }
                    className="contos-btn contos-btn--rect contos-btn--primary"
                    onClick={() => void submitUpdate()}
                  >
                    {t('postiz.calendar.saveChanges')}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    className="contos-btn contos-btn--rect contos-btn--secondary"
                    onClick={() => void submitStatus('schedule')}
                  >
                    {t('postiz.calendar.markScheduled')}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    className="contos-btn contos-btn--rect contos-btn--secondary"
                    onClick={() => void submitStatus('draft')}
                  >
                    {t('postiz.calendar.markDraft')}
                  </button>
                  <button
                    type="button"
                    disabled={saving || deleting}
                    className="contos-btn contos-btn--rect contos-btn--secondary"
                    onClick={() => setDeleteOpen(true)}
                  >
                    {t('common.delete')}
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={saving}
                className="contos-btn contos-btn--rect contos-btn--secondary"
                onClick={() => setModalOpen(false)}
              >
                {t('common.cancel')}
              </button>
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
    </div>
  )
}
