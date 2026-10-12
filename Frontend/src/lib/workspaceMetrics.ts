import { parseCompetitorSummary } from './summaries'

export const THEME_PALETTE = [
  '#c4b5fd',
  '#93c5fd',
  '#fdba74',
  '#86efac',
  '#f9a8d4',
  '#fcd34d',
  '#a5b4fc',
  '#67e8f9',
] as const

export const THEME_PILL_CLASS = [
  'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  'bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200',
  'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
] as const

export type ThemeSlice = {
  theme: string
  posts: number
  percent: number
  color: string
  pillClass: string
}

export type DisplayedPostCount =
  | { kind: 'count'; count: number }
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'unreadable' }

export function primaryThemeFromSummary(summary: unknown): string | null {
  const parsed = parseCompetitorSummary(summary)
  if (!parsed) {
    return null
  }

  const theme = parsed.content_strategies_themes.find((item) => item.trim().length > 0)
  return theme?.trim() ?? null
}

export function summaryPostCount(summary: unknown): number | null {
  const parsed = parseCompetitorSummary(summary)
  if (!parsed) {
    return null
  }

  const count = parsed.aggregated_engagement_metrics.total_content_count
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
    return null
  }

  return count
}

export function resolveDisplayedPostCount(
  hasSummaryRow: boolean,
  summary: unknown,
  scrapedCount: number | undefined,
  scrapedQueryFailed: boolean,
): DisplayedPostCount {
  if (hasSummaryRow) {
    const count = summaryPostCount(summary)
    if (count === null) {
      return { kind: 'unreadable' }
    }
    return { kind: 'count', count }
  }

  if (scrapedQueryFailed) {
    return { kind: 'failed' }
  }

  if (scrapedCount === undefined) {
    return { kind: 'pending' }
  }

  return { kind: 'count', count: scrapedCount }
}

export function sumReadyPostCounts(counts: DisplayedPostCount[]): number | null {
  if (counts.some((entry) => entry.kind !== 'count')) {
    return null
  }

  return counts.reduce((total, entry) => total + (entry.kind === 'count' ? entry.count : 0), 0)
}

function allocatePercents(counts: number[], sum: number): number[] {
  if (sum <= 0) {
    return counts.map(() => 0)
  }

  const raw = counts.map((count) => (count / sum) * 100)
  const floors = raw.map((value) => Math.floor(value))
  let remainder = 100 - floors.reduce((total, value) => total + value, 0)
  const order = raw
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)

  for (const item of order) {
    if (remainder <= 0) {
      break
    }
    floors[item.index] += 1
    remainder -= 1
  }

  return floors
}

export function buildThemeDistribution(
  entries: { theme: string | null; posts: number | null }[],
): { slices: ThemeSlice[]; total: number } {
  const totals = new Map<string, number>()

  for (const entry of entries) {
    if (!entry.theme || entry.posts === null || entry.posts <= 0) {
      continue
    }
    totals.set(entry.theme, (totals.get(entry.theme) ?? 0) + entry.posts)
  }

  const ranked = [...totals.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )
  const counts = ranked.map(([, posts]) => posts)
  const total = counts.reduce((sum, posts) => sum + posts, 0)
  const percents = allocatePercents(counts, total)

  return {
    total,
    slices: ranked.map(([theme, posts], index) => ({
      theme,
      posts,
      percent: percents[index] ?? 0,
      color: THEME_PALETTE[index % THEME_PALETTE.length],
      pillClass: THEME_PILL_CLASS[index % THEME_PILL_CLASS.length],
    })),
  }
}

export function themeStyleFor(
  theme: string | null,
  slices: ThemeSlice[],
): { color: string; pillClass: string } | null {
  if (!theme) {
    return null
  }

  const match = slices.find((slice) => slice.theme === theme)
  if (match) {
    return { color: match.color, pillClass: match.pillClass }
  }

  return {
    color: THEME_PALETTE[0],
    pillClass: THEME_PILL_CLASS[0],
  }
}
