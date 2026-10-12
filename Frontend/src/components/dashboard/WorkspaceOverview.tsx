import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { OverviewWorkspaceHeader } from './OverviewWorkspaceHeader'
import { ChatIcon } from '../icons/ActionIcons'
import { MAX_COMPETITORS_PER_AVATAR, type Competitor } from '../../lib/competitors'
import { displayCompetitorHandle } from '../../lib/instagram-display'
import type { DashboardSummary } from '../../lib/summaries'
import {
  buildThemeDistribution,
  primaryThemeFromSummary,
  resolveDisplayedPostCount,
  summaryPostCount,
  sumReadyPostCounts,
  themeStyleFor,
  type DisplayedPostCount,
} from '../../lib/workspaceMetrics'
import type { PipelineStep } from '../../types/contos'

type WorkspaceOverviewProps = {
  projectId: string
  competitors: Competitor[]
  summariesByCompetitorId: Map<string, DashboardSummary>
  scrapedCounts: Map<string, number> | null
  scrapedQueryFailed: boolean
  onAddCompetitor: () => void
  isAddCompetitorOpen: boolean
  onRetry: (competitorId: string) => void
  onDelete: (competitorId: string) => void
  retryingCompetitorId: string | null
  deletingCompetitorId: string | null
}

function formatCount(value: DisplayedPostCount, pendingLabel: string): string {
  if (value.kind === 'count') {
    return value.count.toLocaleString()
  }
  if (value.kind === 'pending') {
    return pendingLabel
  }
  return '—'
}

function formatScrapedAt(value: string | null, language: string): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return new Intl.DateTimeFormat(language, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

const STRATEGY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'or',
  'for',
  'of',
  'the',
  'to',
  'with',
  'in',
  'on',
  'by',
  'from',
])

function shortPrimaryStrategy(theme: string): string {
  const words = theme
    .trim()
    .split(/[\s/]+/)
    .flatMap((word) => word.split('-'))
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((word) => word.length > 0 && !STRATEGY_STOP_WORDS.has(word.toLowerCase()))

  return words[0] ?? theme.trim()
}

function statusKind(step: string): 'done' | 'failed' | 'inProgress' {
  if (step === 'done') {
    return 'done'
  }
  if (step === 'failed') {
    return 'failed'
  }
  return 'inProgress'
}

const STATUS_CLASS = {
  done: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200',
  inProgress: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-200',
} as const

export function WorkspaceOverview({
  projectId,
  competitors,
  summariesByCompetitorId,
  scrapedCounts,
  scrapedQueryFailed,
  onAddCompetitor,
  isAddCompetitorOpen,
  onRetry,
  onDelete,
  retryingCompetitorId,
  deletingCompetitorId,
}: WorkspaceOverviewProps) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const atCap = competitors.length >= MAX_COMPETITORS_PER_AVATAR
  const pendingLabel = t('common.loading')

  const rows = competitors.map((competitor, index) => {
    const summary = summariesByCompetitorId.get(competitor.id)
    const postCount = resolveDisplayedPostCount(
      summary !== undefined,
      summary?.summary,
      scrapedCounts?.get(competitor.id),
      scrapedQueryFailed,
    )
    return {
      competitor,
      number: index + 1,
      handle: displayCompetitorHandle(competitor.handle_or_url, competitor.platform),
      postCount,
      theme: summary ? primaryThemeFromSummary(summary.summary) : null,
    }
  })

  const distribution = buildThemeDistribution(
    rows.map((row) => ({
      theme: row.theme,
      posts: summariesByCompetitorId.has(row.competitor.id)
        ? summaryPostCount(summariesByCompetitorId.get(row.competitor.id)?.summary)
        : null,
    })),
  )

  const totalPosts = sumReadyPostCounts(rows.map((row) => row.postCount))
  const totalLabel =
    totalPosts === null
      ? rows.some((row) => row.postCount.kind === 'pending') && !scrapedQueryFailed
        ? pendingLabel
        : '—'
      : totalPosts.toLocaleString()

  const normalizedQuery = query.trim().toLowerCase()
  const visibleRows = normalizedQuery
    ? rows.filter((row) => row.handle.toLowerCase().includes(normalizedQuery))
    : rows

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <OverviewWorkspaceHeader
          className="mb-0"
          title={t('dashboard.workspaceTitle')}
          subtitle={t('dashboard.workspaceSubtitle')}
        />
        <Link
          to={`/dashboard/${projectId}/agents`}
          className="contos-btn contos-btn--pill contos-btn--primary shrink-0"
        >
          <ChatIcon />
          {t('dashboard.openChat')}
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label={t('dashboard.competitorsStat')} value={String(competitors.length)} />
        <StatCard label={t('dashboard.totalPostsScraped')} value={totalLabel} />
      </div>

      <section className="rounded-3xl border border-border-hairline bg-white p-6 shadow-[0_8px_30px_rgba(28,27,41,0.04)] dark:bg-canvas-raised sm:p-8">
        <h2 className="font-serif text-lg text-ink">{t('dashboard.contentDistribution')}</h2>
        <div className="mx-auto mt-8 flex w-fit max-w-full flex-col items-center gap-8 sm:flex-row sm:items-center sm:gap-12">
          <DistributionDonut
            total={distribution.total}
            slices={distribution.slices}
            centerLabel={t('dashboard.distributionCenter')}
          />
          {distribution.slices.length === 0 ? (
            <p className="max-w-xs text-sm text-ink-muted">{t('dashboard.distributionEmpty')}</p>
          ) : (
            <ul className="grid w-fit grid-cols-[auto_max-content_auto] items-center gap-x-3 gap-y-5">
              {distribution.slices.map((slice) => (
                <li key={slice.theme} className="contents">
                  <span
                    className="h-2.5 w-2.5 justify-self-center rounded-full"
                    style={{ backgroundColor: slice.color }}
                  />
                  <div className="text-left">
                    <p className="whitespace-nowrap text-sm font-medium text-ink" title={slice.theme}>
                      {shortPrimaryStrategy(slice.theme)}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {t('dashboard.distributionCount', { count: slice.posts })}
                    </p>
                  </div>
                  <span className="pl-8 text-right text-sm font-medium tabular-nums text-ink">
                    {slice.percent}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="min-w-0 rounded-3xl border border-border-hairline bg-white shadow-[0_8px_30px_rgba(28,27,41,0.04)] dark:bg-canvas-raised">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-hairline px-5 py-4 sm:px-6">
          <div>
            <h2 className="font-serif text-lg text-ink">{t('dashboard.competitorsStat')}</h2>
            <p className="text-xs text-ink-muted">
              {t('analytics.tracked', {
                count: competitors.length,
                max: MAX_COMPETITORS_PER_AVATAR,
              })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="workspace-competitor-search">
              {t('dashboard.searchCompetitors')}
            </label>
            <input
              id="workspace-competitor-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('dashboard.searchCompetitors')}
              className="h-10 w-48 rounded-full border border-border-hairline bg-white px-4 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-accent-primary dark:bg-canvas"
            />
            <button
              type="button"
              onClick={onAddCompetitor}
              disabled={atCap || isAddCompetitorOpen}
              title={
                atCap
                  ? t('onboarding.competitors.maxReached', { max: MAX_COMPETITORS_PER_AVATAR })
                  : undefined
              }
              className="contos-btn contos-btn--pill contos-btn--primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAddCompetitorOpen ? t('competitors.addingCompetitor') : t('competitors.addCompetitor')}
            </button>
          </div>
        </div>

        <div className="w-full overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-muted">
              <tr className="border-b border-border-hairline">
                <th className="whitespace-nowrap px-5 py-3 font-medium">{t('dashboard.columns.number')}</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">{t('dashboard.columns.username')}</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">{t('dashboard.columns.platform')}</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">{t('dashboard.columns.postsScraped')}</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">{t('dashboard.columns.primaryStrategy')}</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">{t('dashboard.columns.status')}</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">{t('dashboard.columns.lastScraped')}</th>
                <th className="whitespace-nowrap px-5 py-3 text-right font-medium">{t('dashboard.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-sm text-ink-muted">
                    {competitors.length === 0
                      ? t('dashboard.noCompetitors')
                      : t('dashboard.tableNoMatches')}
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => {
                  const step = row.competitor.pipeline_step as PipelineStep
                  const kind = statusKind(step)
                  const style = themeStyleFor(row.theme, distribution.slices)
                  const initial = row.handle.replace(/^@/, '').charAt(0).toUpperCase() || '?'
                  const canRetry = step === 'failed' || step === 'queued'
                  return (
                    <tr key={row.competitor.id} className="border-b border-border-hairline last:border-b-0">
                      <td className="px-5 py-4 tabular-nums text-ink-muted">{row.number}</td>
                      <td className="px-3 py-4">
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e8e0fe] text-sm font-semibold text-[#4b3568]">
                            {initial}
                          </span>
                          <span className="whitespace-nowrap font-medium text-ink">{row.handle}</span>
                        </span>
                      </td>
                      <td className="px-3 py-4 text-ink">
                        {t(`common.platforms.${row.competitor.platform}`, {
                          defaultValue: row.competitor.platform,
                        })}
                      </td>
                      <td className="px-3 py-4 tabular-nums text-ink">
                        {formatCount(row.postCount, pendingLabel)}
                      </td>
                      <td className="px-3 py-4">
                        {row.theme && style ? (
                          <span
                            title={row.theme}
                            className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${style.pillClass}`}
                          >
                            {shortPrimaryStrategy(row.theme)}
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASS[kind]}`}>
                          {t(`pipeline.status.${kind}`)}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-ink-muted">
                        {formatScrapedAt(row.competitor.last_scraped_at, i18n.language)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <RowActions
                          handle={row.handle}
                          canRetry={canRetry}
                          isRetrying={retryingCompetitorId === row.competitor.id}
                          isDeleting={deletingCompetitorId === row.competitor.id}
                          onRetry={() => onRetry(row.competitor.id)}
                          onDelete={() => onDelete(row.competitor.id)}
                        />
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <section className="rounded-3xl border border-border-hairline bg-white px-6 py-5 shadow-[0_8px_30px_rgba(28,27,41,0.04)] dark:bg-canvas-raised">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-2 font-serif text-3xl tabular-nums text-ink">{value}</p>
    </section>
  )
}

function DistributionDonut({
  total,
  slices,
  centerLabel,
}: {
  total: number
  slices: { theme: string; posts: number; color: string }[]
  centerLabel: string
}) {
  const radius = 42
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <svg viewBox="0 0 120 120" className="h-52 w-52 shrink-0" role="img" aria-label={centerLabel}>
      <circle
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        className="stroke-[#efeaf8] dark:stroke-[#2d2d30]"
        strokeWidth="16"
      />
      {total > 0
        ? slices.map((slice) => {
            const length = (slice.posts / total) * circumference
            const dash = `${length} ${circumference - length}`
            const circle = (
              <circle
                key={slice.theme}
                cx="60"
                cy="60"
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth="16"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                transform="rotate(-90 60 60)"
              />
            )
            offset += length
            return circle
          })
        : null}
      <text
        x="60"
        y="56"
        textAnchor="middle"
        fill="currentColor"
        className="text-ink"
        fontSize="16"
        fontWeight="700"
      >
        {total.toLocaleString()}
      </text>
      <text
        x="60"
        y="70"
        textAnchor="middle"
        fill="currentColor"
        className="text-ink-muted"
        fontSize="5.5"
      >
        {centerLabel}
      </text>
    </svg>
  )
}

function RowActions({
  handle,
  canRetry,
  isRetrying,
  isDeleting,
  onRetry,
  onDelete,
}: {
  handle: string
  canRetry: boolean
  isRetrying: boolean
  isDeleting: boolean
  onRetry: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const busy = isRetrying || isDeleting
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
  }, [open, canRetry])

  useEffect(() => {
    if (!open) {
      return
    }

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={t('dashboard.rowActions', { handle })}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-muted hover:bg-[#f4effc] dark:hover:bg-canvas"
      >
        <span aria-hidden>···</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="menu"
              style={{
                top: coords?.top ?? -9999,
                left: coords?.left ?? 0,
              }}
              className="fixed z-50 w-40 rounded-2xl border border-border-hairline bg-white p-1 text-left shadow-[0_16px_40px_rgba(0,0,0,0.28)] dark:bg-canvas-raised"
            >
              {canRetry ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setOpen(false)
                    onRetry()
                  }}
                  className="block w-full rounded-xl px-3 py-2 text-sm text-ink hover:bg-[#f4effc] disabled:opacity-50 dark:hover:bg-canvas"
                >
                  {isRetrying
                    ? t('competitors.progressCard.starting')
                    : t('competitors.progressCard.retryResearch')}
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setOpen(false)
                  onDelete()
                }}
                className="block w-full rounded-xl px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/40"
              >
                {isDeleting
                  ? t('competitors.progressCard.deleting')
                  : t('competitors.progressCard.delete')}
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
