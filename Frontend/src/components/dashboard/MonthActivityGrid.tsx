import {
  dayCellClass,
  dayCellState,
  formatDayLabel,
  leadingBlankCount,
  todayKeyFromDays,
  weekdayLabels,
  type ConsistencyDay,
} from '../../lib/consistency'

type MonthActivityGridProps = {
  month: string
  days: ConsistencyDay[]
  locale: string
  postedLabel: string
  noPostLabel: string
  compact?: boolean
}

export function MonthActivityGrid({
  month,
  days,
  locale,
  postedLabel,
  noPostLabel,
  compact = false,
}: MonthActivityGridProps) {
  const today = todayKeyFromDays(days)
  const blanks = leadingBlankCount(month)
  const labels = weekdayLabels(locale)
  const cellClass = compact ? 'h-3 w-3 rounded-[3px]' : 'h-8 w-8 rounded-md text-[10px]'

  return (
    <div className={compact ? 'grid grid-cols-7 gap-1' : 'grid grid-cols-7 gap-1.5'}>
      {compact
        ? null
        : labels.map((label, index) => (
            <span
              key={`${label}-${index}`}
              className="text-center text-[10px] font-medium text-ink-muted"
            >
              {label}
            </span>
          ))}
      {Array.from({ length: blanks }, (_, index) => (
        <span key={`blank-${index}`} aria-hidden className={cellClass} />
      ))}
      {days.map((day) => {
        const state = dayCellState(day, today)
        const status = day.posted ? postedLabel : noPostLabel
        const label = `${formatDayLabel(day.date, locale)} ${status}`
        return (
          <span
            key={day.date}
            title={label}
            aria-label={label}
            data-state={state}
            className={`inline-flex items-center justify-center ${cellClass} ${dayCellClass(state)}`}
          >
            {compact ? null : (
              <span className={day.posted ? 'text-btn-primary-fg' : 'text-ink-muted'}>
                {Number(day.date.slice(8))}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}
