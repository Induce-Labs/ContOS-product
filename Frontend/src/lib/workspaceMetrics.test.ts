import { describe, expect, it } from 'vitest'
import type { CompetitorSummary } from '../types/contos'
import {
  buildThemeDistribution,
  primaryThemeFromSummary,
  resolveDisplayedPostCount,
  summaryPostCount,
  sumReadyPostCounts,
} from './workspaceMetrics'

function summary(overrides: Partial<CompetitorSummary> = {}): CompetitorSummary {
  return {
    top_performing_content: [],
    recurring_hooks_patterns: [],
    content_strategies_themes: ['Educational'],
    aggregated_engagement_metrics: {
      total_content_count: 10,
      reel_count: 0,
      post_count: 10,
      carousel_count: 0,
      avg_likes: null,
      avg_views: null,
      avg_shares: null,
      avg_comments: null,
      engagement_rate: null,
    },
    strategic_signals: [],
    ...overrides,
  }
}

describe('workspace summary metrics', () => {
  it('uses the first non-empty strategy theme', () => {
    expect(
      primaryThemeFromSummary(
        summary({ content_strategies_themes: ['  ', 'Thought leadership', 'Product'] }),
      ),
    ).toBe('Thought leadership')
  })

  it('returns no theme when the strategy list is empty', () => {
    expect(primaryThemeFromSummary(summary({ content_strategies_themes: [] }))).toBeNull()
  })

  it('reads total_content_count and rejects an unreadable summary', () => {
    expect(summaryPostCount(summary())).toBe(10)
    expect(summaryPostCount({ content_strategies_themes: [] })).toBeNull()
    expect(
      summaryPostCount(
        summary({
          aggregated_engagement_metrics: {
            ...summary().aggregated_engagement_metrics,
            total_content_count: -1,
          },
        }),
      ),
    ).toBeNull()
  })

  it('uses the summary count when a summary exists and scraped rows only when it does not', () => {
    const stored = summary({ aggregated_engagement_metrics: { ...summary().aggregated_engagement_metrics, total_content_count: 4 } })
    expect(resolveDisplayedPostCount(true, stored, 99, false)).toEqual({ kind: 'count', count: 4 })
    expect(resolveDisplayedPostCount(false, null, 7, false)).toEqual({ kind: 'count', count: 7 })
    expect(resolveDisplayedPostCount(false, null, undefined, false)).toEqual({ kind: 'pending' })
    expect(resolveDisplayedPostCount(false, null, undefined, true)).toEqual({ kind: 'failed' })
    expect(resolveDisplayedPostCount(true, { broken: true }, 7, false)).toEqual({ kind: 'unreadable' })
  })

  it('does not total counts while any competitor is pending or failed', () => {
    expect(sumReadyPostCounts([{ kind: 'count', count: 2 }, { kind: 'count', count: 3 }])).toBe(5)
    expect(sumReadyPostCounts([{ kind: 'count', count: 2 }, { kind: 'failed' }])).toBeNull()
    expect(sumReadyPostCounts([{ kind: 'count', count: 2 }, { kind: 'pending' }])).toBeNull()
  })

  it('groups summarized post counts by primary theme', () => {
    const distribution = buildThemeDistribution([
      { theme: 'Educational', posts: 1 },
      { theme: 'Product', posts: 1 },
      { theme: 'Educational', posts: 1 },
      { theme: null, posts: 9 },
      { theme: 'Product', posts: 0 },
    ])

    expect(distribution.total).toBe(3)
    expect(distribution.slices.map((slice) => slice.theme)).toEqual(['Educational', 'Product'])
    expect(distribution.slices.map((slice) => slice.posts)).toEqual([2, 1])
    expect(distribution.slices.reduce((sum, slice) => sum + slice.percent, 0)).toBe(100)
    expect(distribution.slices[0]?.percent).toBe(67)
    expect(distribution.slices[1]?.percent).toBe(33)
    expect(distribution.slices[0]?.color).not.toBe(distribution.slices[1]?.color)
  })

  it('returns an empty distribution when no competitor has a theme', () => {
    expect(buildThemeDistribution([{ theme: null, posts: 4 }, { theme: ' ', posts: null }])).toEqual({
      slices: [],
      total: 0,
    })
  })
})
