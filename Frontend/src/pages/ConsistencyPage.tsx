import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { MonthActivityGrid } from '../components/dashboard/MonthActivityGrid'
import { OverviewWorkspaceHeader } from '../components/dashboard/OverviewWorkspaceHeader'
import { useDashboardShell } from '../hooks/useDashboardShell'
import {
  browserTimeZone,
  canMoveToMonth,
  consistencyPanelState,
  formatMonthLabel,
  monthKeyInTimeZone,
  previousMonthKeys,
  shiftMonth,
} from '../lib/consistency'
import { logDevError, userFacingMessage } from '../lib/devLog'
import { getPostizConsistency, type PostizConsistency } from '../lib/postiz'

export function ConsistencyPage() {
  const { t, i18n } = useTranslation()
  const { projectId } = useParams()
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
  const timeZone = useMemo(() => {
    try {
      return browserTimeZone()
    } catch {
      return null
    }
  }, [])
  const currentMonth = useMemo(
    () => (timeZone ? monthKeyInTimeZone(new Date(), timeZone) : null),
    [timeZone],
  )
  const [monthChoice, setMonthChoice] = useState<{ projectId: string; month: string } | null>(
    null,
  )
  const [result, setResult] = useState<{
    key: string
    data: PostizConsistency | null
    error: string | null
  } | null>(null)
  const [historyRows, setHistoryRows] = useState<{
    projectId: string
    rows: Array<{ month: string; data: PostizConsistency | null; error: string | null }>
  } | null>(null)
  const viewedMonth =
    projectId && monthChoice?.projectId === projectId ? monthChoice.month : (currentMonth ?? '')
  const requestKey = projectId && viewedMonth ? `${projectId}:${viewedMonth}` : ''
  const current = result?.key === requestKey ? result : null
  const data = current?.data ?? null
  const error = timeZone
    ? (current?.error ?? null)
    : t('consistency.loadError', { month: '' })

  useEffect(() => {
    if (!projectId || !timeZone || !viewedMonth) {
      return
    }
    const activeKey = `${projectId}:${viewedMonth}`
    let cancelled = false
    getPostizConsistency(projectId, viewedMonth, timeZone)
      .then((loaded) => {
        if (!cancelled) setResult({ key: activeKey, data: loaded, error: null })
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setResult({
            key: activeKey,
            data: null,
            error: (() => {
              logDevError('consistency load', {
                error: cause instanceof Error ? cause.message : String(cause),
              })
              return userFacingMessage(
                cause,
                t('consistency.loadError', { month: viewedMonth }),
              )
            })(),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, viewedMonth, timeZone, t])

  useEffect(() => {
    if (!projectId || !timeZone || !currentMonth) {
      return
    }
    const activeProjectId = projectId
    const months = previousMonthKeys(currentMonth, 6)
    let cancelled = false
    Promise.all(
      months.map((month) =>
        getPostizConsistency(activeProjectId, month, timeZone)
          .then((loaded) => ({ month, data: loaded, error: null as string | null }))
          .catch((cause: unknown) => ({
            month,
            data: null,
            error: (() => {
              logDevError('consistency history', {
                error: cause instanceof Error ? cause.message : String(cause),
                month,
              })
              return userFacingMessage(cause, t('consistency.loadError', { month }))
            })(),
          })),
      ),
    ).then((rows) => {
      if (!cancelled) setHistoryRows({ projectId: activeProjectId, rows })
    })
    return () => {
      cancelled = true
    }
  }, [projectId, timeZone, currentMonth, t])

  const panel = consistencyPanelState({
    loading: Boolean(timeZone && requestKey && current === null),
    error,
    connected: data?.connected ?? null,
  })
  const monthTitle = viewedMonth ? formatMonthLabel(viewedMonth, i18n.language, true) : ''
  const monthName = viewedMonth ? formatMonthLabel(viewedMonth, i18n.language, false) : ''
  const historical = Boolean(currentMonth && viewedMonth && viewedMonth < currentMonth)

  function move(delta: number) {
    if (!projectId || !viewedMonth || !currentMonth) return
    const next = shiftMonth(viewedMonth, delta)
    if (!canMoveToMonth(next, currentMonth)) return
    setMonthChoice({ projectId, month: next })
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
      <OverviewWorkspaceHeader title={t('consistency.title')} subtitle={t('consistency.subtitle')} />
      <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6 shadow-[0_16px_40px_rgba(28,27,41,0.05)] sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-ink-muted hover:bg-canvas hover:text-ink"
            aria-label={t('consistency.previousMonth')}
            onClick={() => move(-1)}
          >
            ←
          </button>
          <h2 className="font-serif text-xl text-ink">{monthTitle}</h2>
          <button
            type="button"
            className="rounded-lg px-2 py-1 text-sm text-ink-muted hover:bg-canvas hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
            aria-label={t('consistency.nextMonth')}
            disabled={
              !viewedMonth ||
              !currentMonth ||
              !canMoveToMonth(shiftMonth(viewedMonth, 1), currentMonth)
            }
            onClick={() => move(1)}
          >
            →
          </button>
        </div>

        {panel === 'loading' ? (
          <p className="mt-6 text-sm text-ink-muted">{t('consistency.loading')}</p>
        ) : null}
        {panel === 'error' ? (
          <p className="mt-6 text-sm text-ink" role="alert">
            {error ?? t('consistency.loadError', { month: monthTitle })}
          </p>
        ) : null}
        {panel === 'disconnected' ? (
          <p className="mt-6 max-w-md text-sm leading-relaxed text-ink-muted">
            {t('consistency.connectToStart')}
          </p>
        ) : null}
        {panel === 'ready' && data ? (
          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
            <div>
              <p className="font-serif text-4xl leading-none text-ink">
                {data.posted_days}
                <span className="text-2xl text-ink-muted"> / {data.days_in_month}</span>
              </p>
              <p className="mt-1 text-sm text-ink-muted">{t('consistency.postedDays')}</p>
              {data.current_streak !== null ? (
                <p className="mt-4 text-sm text-ink">
                  {t('consistency.dayStreak', { count: data.current_streak })}
                </p>
              ) : null}
              <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                {t('consistency.longestStreak')}
              </p>
              <p className="mt-1 text-sm text-ink">
                {t('consistency.longestStreakValue', { count: data.longest_streak })}
              </p>
              {historical ? (
                <div className="mt-6 border-t border-border-hairline pt-4">
                  <p className="text-sm font-medium text-ink">
                    {t('consistency.monthComplete', { month: monthName })}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {t('consistency.monthCompleteBody', {
                      posted: data.posted_days,
                      total: data.days_in_month,
                    })}
                  </p>
                  <p className="mt-2 text-sm text-ink-muted">
                    {t('consistency.longestStreak')}:{' '}
                    {t('consistency.longestStreakValue', { count: data.longest_streak })}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {t('consistency.linkedin')}:{' '}
                    {t('consistency.postingDaysCount', { count: data.linkedin_posted_days })}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">
                    {t('consistency.x')}:{' '}
                    {t('consistency.postingDaysCount', { count: data.x_posted_days })}
                  </p>
                </div>
              ) : null}
            </div>
            <MonthActivityGrid
              month={data.month}
              days={data.days}
              locale={i18n.language}
              postedLabel={t('consistency.posted')}
              noPostLabel={t('consistency.noPost')}
            />
          </div>
        ) : null}

        {panel === 'ready' && data ? (
          <div className="mt-8 border-t border-border-hairline pt-6">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              {t('consistency.platformActivity')}
            </h3>
            <dl className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-ink">{t('consistency.linkedin')}</dt>
                <dd className="text-sm text-ink-muted">
                  {t('consistency.postingDaysCount', { count: data.linkedin_posted_days })}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-ink">{t('consistency.x')}</dt>
                <dd className="text-sm text-ink-muted">
                  {t('consistency.postingDaysCount', { count: data.x_posted_days })}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-ink">{t('consistency.totalPublishedPosts')}</dt>
                <dd className="text-sm text-ink-muted">{data.total_published_posts}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </section>

      <section className="mt-6">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          {t('consistency.previousMonths')}
        </h3>
        <div className="mt-3 overflow-x-auto rounded-[1.5rem] border border-border-hairline bg-canvas-raised">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-muted">
              <tr className="border-b border-border-hairline">
                <th className="whitespace-nowrap px-4 py-3 font-medium">{t('consistency.month')}</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">{t('consistency.postedDays')}</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">{t('consistency.longestStreak')}</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">{t('consistency.linkedin')}</th>
                <th className="whitespace-nowrap px-3 py-3 font-medium">{t('consistency.x')}</th>
                <th className="whitespace-nowrap px-4 py-3 font-medium">{t('consistency.totalPublishedPosts')}</th>
              </tr>
            </thead>
            <tbody>
              {historyRows && historyRows.projectId === projectId ? (
                historyRows.rows.map((row) => {
                  const selected = row.month === viewedMonth
                  return (
                    <tr
                      key={row.month}
                      className={`border-b border-border-hairline last:border-b-0 ${
                        selected ? 'bg-accent-primary-soft/40' : ''
                      }`}
                    >
                      <th className="px-4 py-3 text-left font-medium text-ink" scope="row">
                        <button
                          type="button"
                          className="hover:text-accent-primary-deep"
                          onClick={() => {
                            if (projectId && currentMonth && canMoveToMonth(row.month, currentMonth)) {
                              setMonthChoice({ projectId, month: row.month })
                            }
                          }}
                        >
                          {formatMonthLabel(row.month, i18n.language, true)}
                        </button>
                      </th>
                      <td className="px-3 py-3 text-ink-muted">
                        {row.data
                          ? t('consistency.days', {
                              posted: row.data.posted_days,
                              total: row.data.days_in_month,
                            })
                          : row.error
                            ? row.error
                            : t('consistency.loading')}
                      </td>
                      <td className="px-3 py-3 text-ink-muted">
                        {row.data
                          ? t('consistency.longestStreakValue', { count: row.data.longest_streak })
                          : '—'}
                      </td>
                      <td className="px-3 py-3 text-ink-muted">
                        {row.data ? row.data.linkedin_posted_days : '—'}
                      </td>
                      <td className="px-3 py-3 text-ink-muted">
                        {row.data ? row.data.x_posted_days : '—'}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">
                        {row.data ? row.data.total_published_posts : '—'}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-ink-muted">
                    {t('consistency.loading')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </DashboardLayout>
  )
}
