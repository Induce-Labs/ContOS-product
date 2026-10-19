import { stripSuggestionMarkers } from './draftSuggestions'
import { postizContentLength } from './postiz'

export const CHAT_LINKEDIN_CONTENT_LIMIT = 3000
export const CHAT_X_SOFT_LIMIT = 280

export type ChatDraftPlatform = 'linkedin' | 'x'

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as UnknownRecord
  }
  return null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Prefill editable body from a plain LinkedIn or X strategist draft (markers stripped). */
export function plainDraftPrefillText(
  platform: 'linkedin' | 'twitter',
  output: unknown,
): string {
  const record = asRecord(output)
  if (!record) {
    return ''
  }
  if (platform === 'linkedin') {
    const ideas = Array.isArray(record.post_ideas) ? record.post_ideas : []
    const first = asRecord(ideas[0]) ?? {}
    const raw = asString(first.post_structure) || asString(first.hook)
    return stripSuggestionMarkers(raw).trim()
  }
  const tweets = Array.isArray(record.tweet_ideas) ? record.tweet_ideas : []
  const first = asRecord(tweets[0]) ?? {}
  const raw = asString(first.full_tweet) || asString(first.hook)
  return stripSuggestionMarkers(raw).trim()
}

export function canSubmitChatDraft(content: string, mediaUploading: boolean): boolean {
  return content.trim().length > 0 && !mediaUploading
}

export function linkedInOverLimit(content: string): boolean {
  return postizContentLength(content) > CHAT_LINKEDIN_CONTENT_LIMIT
}

export function xOverSoftLimit(content: string): boolean {
  return postizContentLength(content) > CHAT_X_SOFT_LIMIT
}

export function toPostizPlatform(platform: ChatDraftPlatform): 'linkedin' | 'x' {
  return platform
}

/** Local datetime string for `<input type="datetime-local">` / schedule helpers. */
export function defaultScheduleLocalDateTime(from: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const rounded = new Date(from)
  rounded.setSeconds(0, 0)
  // Next 30-minute wall-clock slot so schedule defaults to the future.
  const slotMs = 30 * 60 * 1000
  const next = new Date(Math.ceil((rounded.getTime() + 1) / slotMs) * slotMs)
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`
}

export function formatScheduleHeader(localDateTime: string, locale?: string): string {
  const parsed = new Date(localDateTime)
  if (Number.isNaN(parsed.getTime())) {
    return localDateTime
  }
  return new Intl.DateTimeFormat(locale || undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}
