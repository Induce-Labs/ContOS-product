import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canMoveToMonth,
  consistencyPanelState,
  consistencyRequestUrl,
  dayCellClass,
  dayCellState,
  formatMonthLabel,
  previousMonthKeys,
  shiftMonth,
  showSidebarConsistency,
  type ConsistencyDay,
} from './consistency'
import { parsePostizConsistency } from './postiz'

const LOCALES = ['en', 'es', 'fr', 'hi', 'zh']
const REQUIRED_KEYS = [
  'title',
  'postingConsistency',
  'dayStreak',
  'longestStreak',
  'postedDays',
  'totalPublishedPosts',
  'lastMonth',
  'previousMonth',
  'currentMonth',
  'viewConsistency',
  'posted',
  'noPost',
  'today',
  'pending',
  'monthComplete',
  'days',
  'connectToStart',
  'linkedin',
  'x',
]

function day(date: string, posted: boolean, isToday = false): ConsistencyDay {
  return { date, posted, is_today: isToday }
}

describe('monthly consistency', () => {
  it('labels the current month and counts every day in that month', () => {
    expect(formatMonthLabel('2026-09', 'en', false)).toBe('September')
    const parsed = parsePostizConsistency({
      avatar_id: 'avatar-a',
      timezone: 'Asia/Kolkata',
      month: '2026-09',
      days_in_month: 30,
      connected: true,
      posted_days: 12,
      current_streak: 12,
      longest_streak: 7,
      total_published_posts: 18,
      linkedin_posted_days: 10,
      x_posted_days: 8,
      days: Array.from({ length: 30 }, (_, index) => ({
        date: `2026-09-${String(index + 1).padStart(2, '0')}`,
        posted: index < 12,
        is_today: index === 28,
      })),
    })
    expect(parsed.days).toHaveLength(30)
    expect(parsed.current_streak).toBe(12)
    expect(parsed.posted_days).toBe(12)
    expect(parsed.days_in_month).toBe(30)
  })

  it('marks posted, missed, today pending, and today posted', () => {
    expect(dayCellState(day('2026-09-12', true), '2026-09-29')).toBe('posted')
    expect(dayCellState(day('2026-09-13', false), '2026-09-29')).toBe('missed')
    expect(dayCellState(day('2026-09-29', false, true), '2026-09-29')).toBe('today-pending')
    expect(dayCellState(day('2026-09-29', true, true), '2026-09-29')).toBe('today-posted')
    expect(dayCellState(day('2026-09-30', false), '2026-09-29')).toBe('future')
  })

  it('uses filled, outline, and ring classes in light and dark mode', () => {
    expect(dayCellClass('posted')).toContain('bg-accent-primary')
    expect(dayCellClass('posted')).toContain('dark:bg-accent-primary')
    expect(dayCellClass('missed')).toContain('border-border-hairline')
    expect(dayCellClass('missed')).toContain('dark:border-border-hairline')
    expect(dayCellClass('today-pending')).toContain('ring-accent-primary')
    expect(dayCellClass('today-pending')).toContain('dark:ring-accent-primary')
    expect(dayCellClass('future')).toContain('dark:bg-canvas-raised')
  })

  it('refetches when the avatar id changes', () => {
    const first = consistencyRequestUrl('http://localhost:8000', 'avatar-a', '2026-09', 'Asia/Kolkata')
    const second = consistencyRequestUrl('http://localhost:8000', 'avatar-b', '2026-09', 'Asia/Kolkata')
    expect(first).toContain('avatar_id=avatar-a')
    expect(second).toContain('avatar_id=avatar-b')
    expect(first).not.toBe(second)
  })

  it('hides the sidebar tracker when the rail is collapsed', () => {
    expect(showSidebarConsistency(true)).toBe(false)
    expect(showSidebarConsistency(false)).toBe(true)
  })

  it('moves to the previous month and blocks future months', () => {
    expect(shiftMonth('2026-09', -1)).toBe('2026-08')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(canMoveToMonth('2026-08', '2026-09')).toBe(true)
    expect(canMoveToMonth('2026-09', '2026-09')).toBe(true)
    expect(canMoveToMonth('2026-10', '2026-09')).toBe(false)
    expect(previousMonthKeys('2026-09', 2)).toEqual(['2026-08', '2026-07'])
  })

  it('treats a historical month as ready data with a null live streak', () => {
    const parsed = parsePostizConsistency({
      avatar_id: 'avatar-a',
      timezone: 'Asia/Kolkata',
      month: '2026-08',
      days_in_month: 31,
      connected: true,
      posted_days: 21,
      current_streak: null,
      longest_streak: 8,
      total_published_posts: 24,
      linkedin_posted_days: 10,
      x_posted_days: 8,
      days: Array.from({ length: 31 }, (_, index) => ({
        date: `2026-08-${String(index + 1).padStart(2, '0')}`,
        posted: index < 21,
        is_today: false,
      })),
    })
    expect(parsed.current_streak).toBeNull()
    expect(parsed.longest_streak).toBe(8)
    expect(dayCellState(parsed.days[30], null)).toBe('missed')
  })

  it('distinguishes loading, error, and disconnected panels', () => {
    expect(consistencyPanelState({ loading: true, error: null, connected: null })).toBe('loading')
    expect(consistencyPanelState({ loading: false, error: 'failed', connected: null })).toBe('error')
    expect(consistencyPanelState({ loading: false, error: null, connected: false })).toBe('disconnected')
    expect(consistencyPanelState({ loading: false, error: null, connected: true })).toBe('ready')
  })

  it('defines consistency copy in every locale', () => {
    for (const locale of LOCALES) {
      const file = JSON.parse(
        readFileSync(resolve('public/locales', locale, 'common.json'), 'utf8'),
      ) as { nav: Record<string, string>; consistency: Record<string, string> }
      expect(file.nav.consistency).toBeTruthy()
      for (const key of REQUIRED_KEYS) {
        expect(file.consistency[key], `${locale}.${key}`).toBeTruthy()
      }
    }
  })
})
