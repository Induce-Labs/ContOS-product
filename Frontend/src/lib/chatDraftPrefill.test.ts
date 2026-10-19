import { describe, expect, it } from 'vitest'
import {
  CHAT_LINKEDIN_CONTENT_LIMIT,
  canSubmitChatDraft,
  defaultScheduleLocalDateTime,
  linkedInOverLimit,
  plainDraftPrefillText,
  xOverSoftLimit,
} from './chatDraftPrefill'

describe('plainDraftPrefillText', () => {
  it('prefills LinkedIn post_structure and strips suggestion markers', () => {
    const text = plainDraftPrefillText('linkedin', {
      post_ideas: [
        {
          hook: 'ignored',
          post_structure: 'We **shipped Postiz** instead of custom auth.',
        },
      ],
    })
    expect(text).toBe('We shipped Postiz instead of custom auth.')
  })

  it('falls back to LinkedIn hook when post_structure is empty', () => {
    expect(
      plainDraftPrefillText('linkedin', {
        post_ideas: [{ hook: 'Just the hook' }],
      }),
    ).toBe('Just the hook')
  })

  it('prefills X full_tweet and strips markers', () => {
    const text = plainDraftPrefillText('twitter', {
      tweet_ideas: [{ full_tweet: 'Almost built **custom auth**. Used Postiz.' }],
    })
    expect(text).toBe('Almost built custom auth. Used Postiz.')
  })

  it('returns empty string for missing drafts', () => {
    expect(plainDraftPrefillText('linkedin', {})).toBe('')
    expect(plainDraftPrefillText('twitter', null)).toBe('')
  })
})

describe('canSubmitChatDraft', () => {
  it('requires non-empty content and idle media', () => {
    expect(canSubmitChatDraft('hello', false)).toBe(true)
    expect(canSubmitChatDraft('   ', false)).toBe(false)
    expect(canSubmitChatDraft('hello', true)).toBe(false)
  })
})

describe('limits', () => {
  it('flags LinkedIn over the hard limit', () => {
    expect(linkedInOverLimit('a'.repeat(CHAT_LINKEDIN_CONTENT_LIMIT))).toBe(false)
    expect(linkedInOverLimit('a'.repeat(CHAT_LINKEDIN_CONTENT_LIMIT + 1))).toBe(true)
  })

  it('flags X soft limit above 280', () => {
    expect(xOverSoftLimit('a'.repeat(280))).toBe(false)
    expect(xOverSoftLimit('a'.repeat(281))).toBe(true)
  })
})

describe('defaultScheduleLocalDateTime', () => {
  it('returns a local datetime after the given time', () => {
    const from = new Date('2026-10-19T19:05:00')
    const next = defaultScheduleLocalDateTime(from)
    expect(next).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(new Date(next).getTime()).toBeGreaterThan(from.getTime())
  })
})
