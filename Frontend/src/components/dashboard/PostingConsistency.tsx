import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  browserTimeZone,
  consistencyPanelState,
  monthKeyInTimeZone,
  showSidebarConsistency,
} from '../../lib/consistency'
import { logDevError, userFacingMessage } from '../../lib/devLog'
import { getPostizConsistency, type PostizConsistency } from '../../lib/postiz'

type PostingConsistencyProps = {
  avatarId: string | null
  collapsed: boolean
}

type SidebarResult = {
  avatarId: string
  data: PostizConsistency | null
  error: string | null
}

export function PostingConsistency({ avatarId, collapsed }: PostingConsistencyProps) {
  const { t } = useTranslation()
  const [result, setResult] = useState<SidebarResult | null>(null)
  const visible = Boolean(avatarId) && showSidebarConsistency(collapsed)
  const current = result?.avatarId === avatarId ? result : null

  useEffect(() => {
    if (!avatarId || !showSidebarConsistency(collapsed)) {
      return
    }
    const activeAvatarId = avatarId
    let cancelled = false
    Promise.resolve()
      .then(() => {
        const timezone = browserTimeZone()
        const month = monthKeyInTimeZone(new Date(), timezone)
        return getPostizConsistency(activeAvatarId, month, timezone)
      })
      .then((data) => {
        if (!cancelled) setResult({ avatarId: activeAvatarId, data, error: null })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setResult({
            avatarId: activeAvatarId,
            data: null,
            error: (() => {
              logDevError('posting consistency', {
                error: cause instanceof Error ? cause.message : String(cause),
              })
              return userFacingMessage(cause, t('consistency.loadError', { month: '' }))
            })(),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [avatarId, collapsed, t])

  if (!visible || !avatarId) {
    return null
  }

  const data = current?.data ?? null
  const error = current?.error ?? null
  const panel = consistencyPanelState({
    loading: current === null,
    error,
    connected: data?.connected ?? null,
  })
  const countLabel =
    data && (panel === 'ready' || panel === 'disconnected')
      ? t('consistency.days', { posted: data.posted_days, total: data.days_in_month })
      : panel === 'loading'
        ? t('consistency.loading')
        : '—'

  return (
    <div className="mb-1 mt-2.5 flex items-center justify-between gap-2 px-3">
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3.5">
        <p
          className={`min-w-0 truncate text-sm leading-5 ${
            panel === 'ready' ? 'text-ink' : 'text-ink-muted'
          }`}
          title={panel === 'error' ? (error ?? undefined) : undefined}
          role={panel === 'error' ? 'alert' : undefined}
        >
          {countLabel}
        </p>
        <Link
          to={`/dashboard/${avatarId}/consistency`}
          aria-label={t('consistency.viewConsistency')}
          className="inline-flex shrink-0 items-center text-ink-muted transition hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            className="h-4 w-4"
            aria-hidden
          >
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </div>
  )
}
