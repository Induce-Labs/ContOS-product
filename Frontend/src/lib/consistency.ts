export type ConsistencyDay = {
  date: string
  posted: boolean
  is_today: boolean
}

export type DayCellState = 'posted' | 'today-posted' | 'missed' | 'today-pending' | 'future'

export type ConsistencyPanelState = 'loading' | 'error' | 'disconnected' | 'ready'

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export function browserTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!zone || !zone.trim()) {
    throw new Error('Browser timezone is unavailable.')
  }
  return zone
}

export function monthKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  if (!year || !month) {
    throw new Error(`Could not resolve a calendar month in timezone ${timeZone}.`)
  }
  return `${year}-${month}`
}

export function shiftMonth(month: string, delta: number): string {
  const match = MONTH_RE.exec(month)
  if (!match) {
    throw new Error(`month ${month} must be YYYY-MM.`)
  }
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + delta, 1))
  const nextMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${nextMonth}`
}

export function canMoveToMonth(target: string, currentMonth: string): boolean {
  return MONTH_RE.test(target) && MONTH_RE.test(currentMonth) && target <= currentMonth
}

export function previousMonthKeys(currentMonth: string, count = 6): string[] {
  return Array.from({ length: count }, (_, index) => shiftMonth(currentMonth, -(index + 1)))
}

export function showSidebarConsistency(railCollapsed: boolean): boolean {
  return !railCollapsed
}

export function consistencyPanelState(input: {
  loading: boolean
  error: string | null
  connected: boolean | null
}): ConsistencyPanelState {
  if (input.loading) return 'loading'
  if (input.error) return 'error'
  if (input.connected === false) return 'disconnected'
  return 'ready'
}

export function todayKeyFromDays(days: ConsistencyDay[]): string | null {
  return days.find((day) => day.is_today)?.date ?? null
}

export function dayCellState(day: ConsistencyDay, today: string | null): DayCellState {
  if (day.is_today) {
    return day.posted ? 'today-posted' : 'today-pending'
  }
  if (today && day.date > today) return 'future'
  return day.posted ? 'posted' : 'missed'
}

export function dayCellClass(state: DayCellState): string {
  switch (state) {
    case 'posted':
    case 'today-posted':
      return 'bg-accent-primary dark:bg-accent-primary'
    case 'today-pending':
      return 'bg-transparent ring-1 ring-accent-primary dark:ring-accent-primary'
    case 'missed':
      return 'border border-border-hairline bg-transparent dark:border-border-hairline'
    case 'future':
      return 'bg-canvas dark:bg-canvas-raised'
  }
}

export function leadingBlankCount(month: string): number {
  const match = MONTH_RE.exec(month)
  if (!match) {
    throw new Error(`month ${month} must be YYYY-MM.`)
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)).getUTCDay()
}

export function weekdayLabels(locale: string): string[] {
  return Array.from({ length: 7 }, (_, index) =>
    new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2023, 0, 1 + index)),
    ),
  )
}

export function consistencyRequestUrl(
  apiBaseUrl: string,
  avatarId: string,
  month: string,
  timezone: string,
): string {
  const url = new URL(`${apiBaseUrl.replace(/\/$/, '')}/api/postiz/consistency`)
  url.searchParams.set('avatar_id', avatarId)
  url.searchParams.set('month', month)
  url.searchParams.set('timezone', timezone)
  return url.toString()
}

export function formatMonthLabel(month: string, locale: string, withYear: boolean): string {
  const match = MONTH_RE.exec(month)
  if (!match) return month
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: withYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)))
}

export function formatDayLabel(day: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!match) return day
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))),
  )
}
