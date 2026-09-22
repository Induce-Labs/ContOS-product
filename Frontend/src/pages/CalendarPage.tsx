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
  PostizApiError,
  startPostizConnect,
  type PostizCalendarPost,
  type PostizIntegration,
  type PostizPostType,
} from '../lib/postiz'

const POSTIZ_CALLBACK_MESSAGE_TYPE = 'contos:postiz-callback' as const
const POPUP_NAME = 'contos-postiz-oauth'
const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 120_000

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

function stateBadgeClass(state: string): string {
  switch (state.toUpperCase()) {
    case 'PUBLISHED':
      return 'bg-emerald-100 text-emerald-900'
    case 'QUEUE':
      return 'bg-sky-100 text-sky-900'
    case 'DRAFT':
      return 'bg-stone-200 text-stone-800'
    case 'ERROR':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-stone-100 text-stone-700'
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
      />

      {avatarId ? (
        <CalendarPostizPanel key={avatarId} avatarId={avatarId} />
      ) : (
        <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-10">
          <p className="text-sm text-ink-muted">{t('postiz.calendar.checking')}</p>
        </section>
      )}
    </DashboardLayout>
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
  const popupRef = useRef<Window | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const pollDeadlineRef = useRef<number>(0)

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
      if (!isPostizParentMessage(event.data)) {
        return
      }

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
    setUiState('connecting')

    const popup = window.open('about:blank', POPUP_NAME, 'width=640,height=720')
    popupRef.current = popup
    if (!popup) {
      setUiState('error')
      setErrorMessage(t('postiz.calendar.popupBlocked'))
      return
    }

    try {
      const result = await startPostizConnect(avatarId)
      popup.location.href = result.authorization_url
      startPolling()
    } catch (error) {
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
          className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          {disconnectWarning}
        </div>
      ) : null}

      {uiState === 'checking' && (
        <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-10">
          <p className="text-sm text-ink-muted">{t('postiz.calendar.checking')}</p>
        </section>
      )}

      {uiState === 'disconnected' && (
        <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-primary-deep">
            {t('postiz.calendar.connectEyebrow')}
          </p>
          <h2 className="mt-3 font-serif text-2xl text-ink">
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
            className="contos-btn contos-btn--rect contos-btn--primary mt-6"
          >
            {t('postiz.calendar.connectLinkedIn')}
          </button>
        </section>
      )}

      {uiState === 'connecting' && (
        <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-primary-deep">
            {t('postiz.calendar.connectingEyebrow')}
          </p>
          <h2 className="mt-3 font-serif text-2xl text-ink">
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
        <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-primary-deep">
            {t('postiz.calendar.chooseEyebrow')}
          </p>
          <h2 className="mt-3 font-serif text-2xl text-ink">
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
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-canvas-raised text-sm font-semibold text-ink">
                      {candidate.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <span className="text-sm font-medium text-ink">{candidate.name}</span>
                </div>
                <button
                  type="button"
                  disabled={isClaiming}
                  onClick={() => void handleClaimAccount(candidate)}
                  className="contos-btn contos-btn--rect contos-btn--primary"
                >
                  {t('postiz.calendar.useThisAccount')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {uiState === 'connected' && (
        <div className="space-y-6">
          <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-primary-deep">
                  {t('postiz.calendar.connectedEyebrow')}
                </p>
                <h2 className="mt-2 font-serif text-2xl text-ink">
                  {t('postiz.calendar.connectedTitle')}
                </h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
                  {integration
                    ? t('postiz.calendar.linkedinConnectedAs', {
                        name: integration.name,
                      })
                    : t('postiz.calendar.linkedinConnected')}
                </p>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-muted">
                  {t('postiz.calendar.reconnectSwitchHint')}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void loadInitialStatus()}
                  className="contos-btn contos-btn--rect contos-btn--secondary"
                >
                  {t('postiz.calendar.refreshStatus')}
                </button>
                <button
                  type="button"
                  onClick={requestConnectLinkedIn}
                  className="contos-btn contos-btn--rect contos-btn--secondary"
                >
                  {t('postiz.calendar.reconnectLinkedIn')}
                </button>
                <button
                  type="button"
                  onClick={() => setDisconnectOpen(true)}
                  className="contos-btn contos-btn--rect contos-btn--secondary"
                >
                  {t('postiz.calendar.disconnectLinkedIn')}
                </button>
              </div>
            </div>
          </section>

          <AvatarCalendarBoard avatarId={avatarId} />
        </div>
      )}

      {uiState === 'error' && (
        <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-600">
            {t('postiz.calendar.errorEyebrow')}
          </p>
          <h2 className="mt-3 font-serif text-2xl text-ink">{t('postiz.calendar.errorTitle')}</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-red-600">
            {errorMessage ?? t('postiz.calendar.connectFailed')}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={requestConnectLinkedIn}
              className="contos-btn contos-btn--rect contos-btn--primary"
            >
              {t('common.retry')}
            </button>
            <button
              type="button"
              onClick={() => void loadInitialStatus()}
              className="contos-btn contos-btn--rect contos-btn--secondary"
            >
              {t('postiz.calendar.refreshStatus')}
            </button>
          </div>
        </section>
      )}

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

function AvatarCalendarBoard({ avatarId }: { avatarId: string }) {
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
  const [reloadToken, setReloadToken] = useState(0)

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

  function openCreate(day?: number) {
    setModalMode('create')
    setEditingPost(null)
    setFormContent('')
    setFormError(null)
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

  function openEdit(post: PostizCalendarPost) {
    setModalMode('edit')
    setEditingPost(post)
    setFormContent(post.content)
    setFormWhen(isoToLocalDateTimeInput(post.publish_date))
    setFormError(null)
    setModalOpen(true)
  }

  async function submitPost(type: Exclude<PostizPostType, 'update'>) {
    setSaving(true)
    setFormError(null)
    try {
      const publishDate =
        type === 'now' ? nowAsOffsetIso() : localDateTimeToOffsetIso(formWhen)
      await createPostizPost({
        avatarId,
        type,
        content: formContent,
        publishDate,
      })
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

  async function submitUpdate() {
    if (!editingPost) {
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await createPostizPost({
        avatarId,
        type: 'update',
        content: formContent,
        publishDate: localDateTimeToOffsetIso(formWhen),
        postId: editingPost.id,
      })
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

  return (
    <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-4 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="contos-btn contos-btn--rect contos-btn--secondary"
            onClick={goToPreviousMonth}
          >
            {t('postiz.calendar.prevMonth')}
          </button>
          <h3 className="min-w-[10rem] text-center font-serif text-xl text-ink">
            {monthLabel}
          </h3>
          <button
            type="button"
            className="contos-btn contos-btn--rect contos-btn--secondary"
            onClick={goToNextMonth}
          >
            {t('postiz.calendar.nextMonth')}
          </button>
        </div>
        <button
          type="button"
          className="contos-btn contos-btn--rect contos-btn--primary"
          onClick={() => openCreate()}
        >
          {t('postiz.calendar.createPost')}
        </button>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-ink-muted">{t('postiz.calendar.loadingPosts')}</p>
      ) : null}
      {error ? <p className="mt-6 text-sm text-red-600">{error}</p> : null}

      <div className="mt-4 grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-border-hairline bg-border-hairline">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="bg-canvas px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted"
          >
            {label}
          </div>
        ))}
        {calendarCells.map((cell, index) => {
          const dayPosts = cell.day != null ? (postsByDay.get(cell.day) ?? []) : []
          return (
            <div
              key={`${viewYear}-${viewMonth}-${index}`}
              className="min-h-[6.5rem] bg-canvas p-2"
            >
              {cell.day != null ? (
                <>
                  <button
                    type="button"
                    className="text-xs font-semibold text-ink hover:text-accent-primary-deep"
                    onClick={() => openCreate(cell.day ?? undefined)}
                  >
                    {cell.day}
                  </button>
                  <ul className="mt-1 space-y-1">
                    {dayPosts.slice(0, 3).map((post) => (
                      <li key={post.id}>
                        <button
                          type="button"
                          onClick={() => openEdit(post)}
                          className={`block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] ${stateBadgeClass(post.state)}`}
                          title={post.content}
                        >
                          {post.content.slice(0, 40)}
                        </button>
                      </li>
                    ))}
                    {dayPosts.length > 3 ? (
                      <li className="text-[10px] text-ink-muted">
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

      {modalOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="postiz-post-modal-title"
            className="w-full max-w-lg rounded-3xl border border-border-hairline bg-canvas p-6 shadow-xl"
          >
            <h3
              id="postiz-post-modal-title"
              className="font-serif text-2xl text-ink"
            >
              {modalMode === 'create'
                ? t('postiz.calendar.createPostTitle')
                : t('postiz.calendar.editPostTitle')}
            </h3>
            <p className="mt-2 text-sm text-ink-muted">
              {t('postiz.calendar.textOnlyHint')}
            </p>

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
                rows={5}
                className="mt-1 w-full rounded-2xl border border-border-hairline bg-canvas-raised px-3 py-2 text-sm text-ink"
                maxLength={3000}
              />
            </label>

            <label className="mt-4 block text-sm font-medium text-ink">
              {t('postiz.calendar.whenLabel')}
              <input
                type="datetime-local"
                value={formWhen}
                onChange={(event) => setFormWhen(event.target.value)}
                className="mt-1 w-full rounded-2xl border border-border-hairline bg-canvas-raised px-3 py-2 text-sm text-ink"
              />
            </label>
            <p className="mt-1 text-xs text-ink-muted">
              {t('postiz.calendar.timezoneHint')}
            </p>

            {formError ? <p className="mt-3 text-sm text-red-600">{formError}</p> : null}

            <div className="mt-6 flex flex-wrap gap-2">
              {modalMode === 'create' ? (
                <>
                  <button
                    type="button"
                    disabled={saving || !formContent.trim()}
                    className="contos-btn contos-btn--rect contos-btn--primary"
                    onClick={() => void submitPost('now')}
                  >
                    {t('postiz.calendar.publishNow')}
                  </button>
                  <button
                    type="button"
                    disabled={saving || !formContent.trim() || !formWhen}
                    className="contos-btn contos-btn--rect contos-btn--secondary"
                    onClick={() => void submitPost('schedule')}
                  >
                    {t('postiz.calendar.schedule')}
                  </button>
                  <button
                    type="button"
                    disabled={saving || !formContent.trim()}
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
                    disabled={saving || !formContent.trim() || !formWhen}
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
    </section>
  )
}
