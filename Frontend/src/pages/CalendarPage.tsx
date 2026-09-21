import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { OverviewWorkspaceHeader } from '../components/dashboard/OverviewWorkspaceHeader'
import { useDashboardShell } from '../hooks/useDashboardShell'
import {
  getPostizStatus,
  PostizApiError,
  startPostizConnect,
  type PostizChannel,
} from '../lib/postiz'

const POSTIZ_CALLBACK_MESSAGE_TYPE = 'contos:postiz-callback' as const
const POPUP_NAME = 'contos-postiz-oauth'
const POLL_INTERVAL_MS = 5000
const POLL_TIMEOUT_MS = 120_000

type ConnectionUiState =
  | 'checking'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'

type PostizParentMessage =
  | { type: typeof POSTIZ_CALLBACK_MESSAGE_TYPE; status: 'denied' }
  | { type: typeof POSTIZ_CALLBACK_MESSAGE_TYPE; status: 'error'; message: string }

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

export function CalendarPage() {
  const { t } = useTranslation()
  const {
    user,
    projects,
    setProjects,
    activeProject,
    projectsLoading,
    isSigningOut,
    sidebarOpen,
    setSidebarOpen,
    handleSignOut,
  } = useDashboardShell()

  const [uiState, setUiState] = useState<ConnectionUiState>('checking')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [channels, setChannels] = useState<PostizChannel[]>([])
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
    (nextChannels: PostizChannel[]) => {
      setChannels(nextChannels)
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
        const status = await getPostizStatus()
        if (cancelled) {
          return
        }
        if (status.connected) {
          setChannels(status.channels)
          setUiState('connected')
          setErrorMessage(null)
        } else {
          setChannels([])
          setUiState('disconnected')
        }
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
    }
  }, [t])

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
    const status = await getPostizStatus()
    if (status.connected) {
      applyConnected(status.channels)
      return true
    }
    setChannels([])
    return false
  }, [applyConnected])

  async function loadInitialStatus() {
    setUiState('checking')
    setErrorMessage(null)
    try {
      const connected = await refreshStatus()
      if (!connected) {
        setUiState('disconnected')
      }
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
          setUiState('error')
          setErrorMessage(t('postiz.calendar.timeout'))
          return
        }

        if (popupRef.current?.closed) {
          try {
            const connected = await refreshStatus()
            if (!connected) {
              stopPolling()
              setUiState('error')
              setErrorMessage(t('postiz.calendar.popupClosed'))
            }
          } catch (error) {
            stopPolling()
            setUiState('error')
            setErrorMessage(
              error instanceof Error ? error.message : t('postiz.calendar.statusFailed'),
            )
          }
          return
        }

        try {
          await refreshStatus()
        } catch (error) {
          // Keep polling transient failures until timeout; surface only hard auth failures.
          if (error instanceof PostizApiError && error.statusCode === 401) {
            stopPolling()
            closePopup()
            setUiState('error')
            setErrorMessage(error.message)
          }
        }
      })()
    }, POLL_INTERVAL_MS)
  }, [closePopup, refreshStatus, stopPolling, t])

  async function handleConnectLinkedIn() {
    setErrorMessage(null)
    setUiState('connecting')

    const popup = window.open('about:blank', POPUP_NAME, 'width=720,height=820')
    if (!popup) {
      setUiState('error')
      setErrorMessage(t('postiz.calendar.popupBlocked'))
      return
    }
    popupRef.current = popup

    try {
      const result = await startPostizConnect()
      popup.location.href = result.authorization_url
      startPolling()
    } catch (error) {
      closePopup()
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
          <button
            type="button"
            onClick={() => void handleConnectLinkedIn()}
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
        </section>
      )}

      {uiState === 'connected' && (
        <>
          <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-primary-deep">
              {t('postiz.calendar.connectedEyebrow')}
            </p>
            <h2 className="mt-3 font-serif text-2xl text-ink">
              {t('postiz.calendar.connectedTitle')}
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
              {channels.length > 0
                ? t('postiz.calendar.linkedinConnectedAs', {
                    name: channels.map((channel) => channel.name).join(', '),
                  })
                : t('postiz.calendar.linkedinConnected')}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void loadInitialStatus()}
                className="contos-btn contos-btn--rect contos-btn--secondary"
              >
                {t('postiz.calendar.refreshStatus')}
              </button>
              <button
                type="button"
                onClick={() => void handleConnectLinkedIn()}
                className="contos-btn contos-btn--rect contos-btn--primary"
              >
                {t('postiz.calendar.reconnectLinkedIn')}
              </button>
            </div>
          </section>
          <p className="mt-4 max-w-xl px-1 text-sm leading-relaxed text-ink-muted">
            {t('postiz.calendar.schedulingSoon')}
          </p>
        </>
      )}

      {uiState === 'error' && (
        <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-primary-deep">
            {t('postiz.calendar.errorEyebrow')}
          </p>
          <h2 className="mt-3 font-serif text-2xl text-ink">{t('postiz.calendar.errorTitle')}</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-red-600">
            {errorMessage ?? t('postiz.calendar.connectFailed')}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleConnectLinkedIn()}
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
    </DashboardLayout>
  )
}
