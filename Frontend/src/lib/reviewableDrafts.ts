import {
  CHAT_LINKEDIN_CONTENT_LIMIT,
  CHAT_X_SOFT_LIMIT,
} from './chatDraftPrefill'
import { postizContentLength, type PostizMediaItem } from './postiz'

export type ReviewPlatform = 'linkedin' | 'instagram' | 'x'
export type ReviewStatus =
  | 'needs_review'
  | 'draft'
  | 'scheduled'
  | 'published'
  | 'uncertain'
  | 'failed'
export type ReviewSource = 'post_ideas' | 'tweet_ideas' | 'thread' | 'content_calendar'

export type ReviewPost = {
  id: string
  messageId: string
  platform: ReviewPlatform
  source: ReviewSource
  sourceIndex: number
  text: string
  originalText: string
  entries: string[] | null
  originalEntries: string[] | null
  proposedDate: string | null
  media: PostizMediaItem[]
  status: ReviewStatus
  postizPostId: string | null
  statusDetail: string | null
  /** Set when the user deletes the card or Postiz accepts a save or schedule. */
  hidden?: boolean
}

export type DraftMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentType?: string
  output?: unknown
  proposalForPostId?: string
}

type UnknownRecord = Record<string, unknown>

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

function asRecord(value: unknown): UnknownRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as UnknownRecord
  return null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function normalizeDraftText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function proposedDate(value: unknown): string | null {
  const raw = asString(value).trim()
  if (!DATE_ONLY.test(raw)) return null
  const parsed = new Date(`${raw}T00:00`)
  if (Number.isNaN(parsed.getTime())) return null
  return raw
}

function platformForAgent(agent: string | undefined, output: UnknownRecord): ReviewPlatform | null {
  const named = asString(output.agent) || asString(output.platform) || agent || ''
  if (named === 'linkedin') return 'linkedin'
  if (named === 'instagram') return 'instagram'
  if (named === 'twitter' || named === 'x') return 'x'
  if (Array.isArray(output.post_ideas) && output.post_ideas.length > 0) return 'linkedin'
  if (Array.isArray(output.content_calendar) && output.content_calendar.length > 0) return 'instagram'
  if (
    (Array.isArray(output.tweet_ideas) && output.tweet_ideas.length > 0) ||
    (Array.isArray(output.thread_structures) && output.thread_structures.length > 0)
  ) {
    return 'x'
  }
  return null
}

type Seed = {
  platform: ReviewPlatform
  source: ReviewSource
  sourceIndex: number
  text: string
  originalText: string
  entries: string[] | null
  originalEntries: string[] | null
  proposedDate: string | null
}

function seedsFor(output: UnknownRecord, platform: ReviewPlatform): Seed[] {
  if (platform === 'linkedin') {
    const ideas = Array.isArray(output.post_ideas) ? output.post_ideas : []
    return ideas.flatMap((raw, sourceIndex) => {
      const item = asRecord(raw)
      if (!item) return []
      const text = asString(item.post_structure) || asString(item.hook)
      if (!text.trim()) return []
      return [
        {
          platform,
          source: 'post_ideas',
          sourceIndex,
          text,
          originalText: text,
          entries: null,
          originalEntries: null,
          proposedDate: proposedDate(item.date),
        },
      ]
    })
  }

  if (platform === 'instagram') {
    const calendar = Array.isArray(output.content_calendar) ? output.content_calendar : []
    return calendar.flatMap((raw, sourceIndex) => {
      const item = asRecord(raw)
      if (!item) return []
      const text = asString(item.copy_paste_post) || asString(item.caption)
      if (!text.trim()) return []
      return [
        {
          platform,
          source: 'content_calendar',
          sourceIndex,
          text,
          originalText: text,
          entries: null,
          originalEntries: null,
          proposedDate: proposedDate(item.date),
        },
      ]
    })
  }

  const threads = Array.isArray(output.thread_structures) ? output.thread_structures : []
  const threadSeeds: Seed[] = threads.flatMap((raw, sourceIndex) => {
    const item = asRecord(raw)
    if (!item || !Array.isArray(item.tweets)) return []
    const entries = item.tweets.map((tweet) => asString(tweet)).filter((tweet) => tweet.trim())
    if (entries.length === 0) return []
    const text = entries.join('\n\n')
    return [
      {
        platform,
        source: 'thread',
        sourceIndex,
        text,
        originalText: text,
        entries,
        originalEntries: [...entries],
        proposedDate: proposedDate(item.date),
      },
    ]
  })
  const threadBodies = new Set(threadSeeds.map((seed) => normalizeDraftText(seed.text)))
  const tweets = Array.isArray(output.tweet_ideas) ? output.tweet_ideas : []
  const tweetSeeds: Seed[] = tweets.flatMap((raw, sourceIndex) => {
    const item = asRecord(raw)
    if (!item) return []
    if (asString(item.type).toLowerCase() === 'thread') return []
    const text = asString(item.full_tweet) || asString(item.hook)
    if (!text.trim() || threadBodies.has(normalizeDraftText(text))) return []
    return [
      {
        platform,
        source: 'tweet_ideas',
        sourceIndex,
        text,
        originalText: text,
        entries: null,
        originalEntries: null,
        proposedDate: proposedDate(item.date),
      },
    ]
  })
  return [...tweetSeeds, ...threadSeeds]
}

function isReviewPost(value: unknown): value is ReviewPost {
  const row = asRecord(value)
  if (!row) return false
  return (
    typeof row.id === 'string' &&
    row.id.trim().length > 0 &&
    typeof row.messageId === 'string' &&
    typeof row.text === 'string' &&
    typeof row.originalText === 'string' &&
    typeof row.source === 'string' &&
    typeof row.sourceIndex === 'number'
  )
}

function storedPosts(output: UnknownRecord): ReviewPost[] {
  if (!Array.isArray(output.review_posts)) return []
  return output.review_posts.filter(isReviewPost)
}

export function requestedDraftDayCount(text: string): number | null {
  const normalized = text.toLowerCase()
  if (/\b(?:a|one|1)\s+week\b|\bthis week\b|\bnext week\b|\bfor the week\b/.test(normalized)) {
    return 7
  }
  const digit = /\b([2-7])\s*-?\s*days?\b/.exec(normalized)
  if (digit) return Number(digit[1])
  const word = /\b(two|three|four|five|six|seven)\s+days?\b/.exec(normalized)
  if (!word) return null
  const counts: Record<string, number> = {
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
  }
  return counts[word[1]] ?? null
}

const POST_WORD_COUNTS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

const POST_PLATFORM = '(?:linkedin|instagram|twitter|x)'
const NOT_AN_IDEA = '(?!\\s+ideas?\\b)'

/** More than one post. A count of ideas does not qualify. There is no upper cap. */
export function requestedDraftPostCount(text: string): number | null {
  const normalized = text.toLowerCase()
  if (
    new RegExp(`\\b(?:a few|several|some|multiple)\\s+posts?\\b${NOT_AN_IDEA}`).test(normalized) ||
    new RegExp(`\\ba couple of\\s+posts?\\b${NOT_AN_IDEA}`).test(normalized)
  ) {
    return 2
  }
  const numbered = new RegExp(
    `\\b(\\d+|${Object.keys(POST_WORD_COUNTS).join('|')})\\s+(?:${POST_PLATFORM}\\s+)?posts?\\b${NOT_AN_IDEA}`,
  ).exec(normalized)
  if (!numbered) return null
  const raw = numbered[1]
  const count = /^\d+$/.test(raw) ? Number(raw) : POST_WORD_COUNTS[raw]
  if (count == null || count < 2) return null
  return count
}

function nearestUserRequest(messages: DraftMessage[], index: number): string | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const message = messages[cursor]
    if (message?.role === 'user') return message.content
  }
  return null
}

export function messageQualifiesForDrafts(messages: DraftMessage[], index: number): boolean {
  const request = nearestUserRequest(messages, index)
  if (request == null) return false
  return requestedDraftDayCount(request) != null || requestedDraftPostCount(request) != null
}

export function readReviewPosts(message: DraftMessage): ReviewPost[] {
  if (message.role !== 'assistant' || message.proposalForPostId) return []
  const output = asRecord(message.output)
  if (!output) return []
  return storedPosts(output).map((post) => ({ ...post, messageId: message.id }))
}

export function collectReviewPosts(messages: DraftMessage[]): ReviewPost[] {
  return messages.flatMap((message, index) => {
    if (!messageQualifiesForDrafts(messages, index)) return []
    return readReviewPosts(message).filter((post) => post.hidden !== true)
  })
}

/**
 * Create stable ids once. Later calls keep those ids, the original text, and edits.
 * `createId` runs only for a new source slot.
 */
export function stampReviewPosts(
  message: DraftMessage,
  createId: () => string,
): { message: DraftMessage; changed: boolean } {
  if (message.role !== 'assistant' || message.proposalForPostId) {
    return { message, changed: false }
  }
  const output = asRecord(message.output)
  if (!output) return { message, changed: false }
  const platform = platformForAgent(message.agentType, output)
  if (!platform) return { message, changed: false }
  const seeds = seedsFor(output, platform)
  if (seeds.length === 0) return { message, changed: false }

  const existing = storedPosts(output)
  const byKey = new Map(existing.map((post) => [`${post.source}:${post.sourceIndex}`, post]))
  let changed = existing.length !== seeds.length
  const review_posts = seeds.map((seed) => {
    const previous = byKey.get(`${seed.source}:${seed.sourceIndex}`)
    if (previous) return { ...previous, messageId: message.id }
    changed = true
    return {
      ...seed,
      id: createId(),
      messageId: message.id,
      media: [],
      status: 'needs_review' as const,
      postizPostId: null,
      statusDetail: null,
    }
  })
  if (!changed) return { message, changed: false }
  return {
    changed: true,
    message: { ...message, output: { ...output, review_posts } },
  }
}

export function stampMissingReviewPosts<T extends DraftMessage>(
  messages: T[],
  createId: () => string,
): { messages: T[]; changed: boolean } {
  let changed = false
  const next = messages.map((message, index) => {
    if (!messageQualifiesForDrafts(messages, index)) return message
    const stamped = stampReviewPosts(message, createId)
    if (!stamped.changed) return message
    changed = true
    return stamped.message as T
  })
  return { messages: changed ? next : messages, changed }
}

function writeSourceText(output: UnknownRecord, post: ReviewPost): UnknownRecord {
  const next = { ...output }
  if (post.source === 'post_ideas' && Array.isArray(output.post_ideas)) {
    next.post_ideas = output.post_ideas.map((raw, index) => {
      if (index !== post.sourceIndex) return raw
      const item = asRecord(raw) ?? {}
      return { ...item, post_structure: post.text }
    })
  }
  if (post.source === 'content_calendar' && Array.isArray(output.content_calendar)) {
    next.content_calendar = output.content_calendar.map((raw, index) => {
      if (index !== post.sourceIndex) return raw
      const item = asRecord(raw) ?? {}
      return { ...item, copy_paste_post: post.text }
    })
  }
  if (post.source === 'tweet_ideas' && Array.isArray(output.tweet_ideas)) {
    next.tweet_ideas = output.tweet_ideas.map((raw, index) => {
      if (index !== post.sourceIndex) return raw
      const item = asRecord(raw) ?? {}
      return { ...item, full_tweet: post.text }
    })
  }
  if (post.source === 'thread' && Array.isArray(output.thread_structures) && post.entries) {
    next.thread_structures = output.thread_structures.map((raw, index) => {
      if (index !== post.sourceIndex) return raw
      const item = asRecord(raw) ?? {}
      return { ...item, tweets: [...post.entries!] }
    })
  }
  return next
}

/** Patch one post inside one message. Other messages keep the same reference. */
export function patchReviewPost<T extends DraftMessage>(
  messages: T[],
  messageId: string,
  postId: string,
  patch: (post: ReviewPost) => ReviewPost,
): T[] {
  let touched = false
  const next = messages.map((message) => {
    if (message.id !== messageId) return message
    const output = asRecord(message.output)
    if (!output) return message
    const posts = storedPosts(output)
    if (!posts.some((post) => post.id === postId)) return message
    touched = true
    let updated: ReviewPost | null = null
    const review_posts = posts.map((post) => {
      if (post.id !== postId) return post
      updated = patch(post)
      return updated
    })
    const withPosts = { ...output, review_posts }
    return {
      ...message,
      output: updated ? writeSourceText(withPosts, updated) : withPosts,
    }
  })
  return touched ? next : messages
}

/** Drop a card from the sidebar. The chat message and a later stamp keep the record. */
export function hideReviewPost<T extends DraftMessage>(
  messages: T[],
  messageId: string,
  postId: string,
): T[] {
  return patchReviewPost(messages, messageId, postId, (post) => ({ ...post, hidden: true }))
}

/** Keep review records when a stream replaces the agent output object. */
export function preserveReviewPosts(previous: unknown, incoming: unknown): unknown {
  const prior = asRecord(previous)
  const next = asRecord(incoming)
  if (!prior || !next) return incoming
  const posts = storedPosts(prior)
  if (posts.length === 0 || storedPosts(next).length > 0) return incoming
  return { ...next, review_posts: posts }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'
  } catch {
    return 'local'
  }
}

export type ScheduleSkipReason =
  | 'needs_time'
  | 'past'
  | 'invalid'
  | 'empty'
  | 'too_long'
  | 'instagram'
  | 'already_scheduled'

export function scheduleSkipReason(
  post: ReviewPost,
  localDateTime: string,
  now: Date,
): ScheduleSkipReason | null {
  if (post.platform === 'instagram') return 'instagram'
  if (post.status === 'published') return 'already_scheduled'
  const trimmed = localDateTime.trim()
  if (!LOCAL_DATE_TIME.test(trimmed)) return 'needs_time'
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return 'invalid'
  if (parsed.getTime() <= now.getTime()) return 'past'
  const parts = post.entries ?? [post.text]
  if (parts.some((entry) => !entry.trim())) return 'empty'
  if (post.platform === 'linkedin' && postizContentLength(post.text) > CHAT_LINKEDIN_CONTENT_LIMIT) {
    return 'too_long'
  }
  if (post.platform === 'x' && parts.some((entry) => postizContentLength(entry) > CHAT_X_SOFT_LIMIT)) {
    return 'too_long'
  }
  return null
}

export function reviewPlatformForAgent(agentType: string | undefined): ReviewPlatform {
  if (agentType === 'twitter' || agentType === 'x') return 'x'
  if (agentType === 'instagram') return 'instagram'
  return 'linkedin'
}

/** First lines of a draft, kept for the chat preview of an added post. */
export function draftPreviewText(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= 280) return trimmed
  return `${trimmed.slice(0, 279).trimEnd()}…`
}

function recordHasPostText(record: UnknownRecord): boolean {
  const lists = [record.post_ideas, record.tweet_ideas, record.content_calendar, record.thread_structures]
  return lists.some((list) => Array.isArray(list) && list.length > 0)
}

function firstJsonObjectSpan(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return null
}

function parseJsonObject(text: string): UnknownRecord | null {
  const span = firstJsonObjectSpan(text)
  if (span) {
    try {
      const parsed: unknown = JSON.parse(span)
      const record = asRecord(parsed)
      if (record) return record
    } catch {
      // A closed span can still be invalid. Repair the whole payload below.
    }
  }
  const start = text.indexOf('{')
  if (start < 0) return null
  return repairTruncatedJson(text.slice(start))
}

function repairTruncatedJson(text: string): UnknownRecord | null {
  let body = text
  let inString = false
  let escape = false
  const stack: string[] = []
  for (const ch of body) {
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) stack.pop()
  }
  if (inString) body += '"'
  else body = body.replace(/,\s*"(?:\\.|[^"\\])*"\s*:?\s*$/u, '')
  body = body.replace(/,\s*$/u, '')
  while (stack.length > 0) {
    const closer = stack.pop()
    if (closer) body += closer
  }
  try {
    const parsed: unknown = JSON.parse(body)
    return asRecord(parsed)
  } catch {
    return null
  }
}

/** Parse a model payload, including a JSON string or a parse-failure wrapper. */
export function parseAgentPayload(value: unknown): UnknownRecord | null {
  if (typeof value === 'string') return parseJsonObject(value)
  const record = asRecord(value)
  if (!record) return null
  const nestedSource = asString(record.display_text) || asString(record.raw_response_excerpt)
  const nested = nestedSource.includes('{') ? parseJsonObject(nestedSource) : null
  if (nested && recordHasPostText(nested) && !recordHasPostText(record)) return nested
  return record
}

export function extractRevision(
  output: unknown,
  platform: ReviewPlatform,
): { text: string; entries: string[] | null } | null {
  const record = parseAgentPayload(output)
  if (!record) return null
  if (platform === 'linkedin') {
    const ideas = Array.isArray(record.post_ideas) ? record.post_ideas : []
    if (ideas.length !== 1) return null
    const item = asRecord(ideas[0])
    const text = item ? asString(item.post_structure).trim() || asString(item.hook).trim() : ''
    return text ? { text, entries: null } : null
  }
  if (platform === 'instagram') {
    const calendar = Array.isArray(record.content_calendar) ? record.content_calendar : []
    if (calendar.length !== 1) return null
    const item = asRecord(calendar[0])
    const text = item ? (asString(item.copy_paste_post) || asString(item.caption)).trim() : ''
    return text ? { text, entries: null } : null
  }
  const threads = Array.isArray(record.thread_structures) ? record.thread_structures : []
  if (threads.length === 1) {
    const item = asRecord(threads[0])
    if (!item || !Array.isArray(item.tweets)) return null
    const entries = item.tweets.map((tweet) => asString(tweet).trim())
    if (
      entries.length === 0 ||
      entries.some((entry) => !entry || postizContentLength(entry) > CHAT_X_SOFT_LIMIT)
    ) {
      return null
    }
    return { text: entries.join('\n\n'), entries }
  }
  const tweets = Array.isArray(record.tweet_ideas) ? record.tweet_ideas : []
  if (tweets.length !== 1 || threads.length > 0) return null
  const item = asRecord(tweets[0])
  const text = item ? (asString(item.full_tweet) || asString(item.hook)).trim() : ''
  if (!text || postizContentLength(text) > CHAT_X_SOFT_LIMIT) return null
  return { text, entries: null }
}

export function acceptRevision(
  post: ReviewPost,
  revision: { text: string; entries: string[] | null },
): ReviewPost {
  return {
    ...post,
    text: revision.text,
    entries: revision.entries ?? (post.entries ? revision.text.split('\n\n') : null),
    media: post.media,
    originalText: post.originalText,
    originalEntries: post.originalEntries,
    status: post.postizPostId ? post.status : 'needs_review',
    statusDetail: null,
  }
}

const LITERAL_EDIT = [
  /^(?:please\s+)?change\s+([\s\S]+?)\s+to\s+([\s\S]+?)\.?$/i,
  /^(?:please\s+)?replace\s+([\s\S]+?)\s+with\s+([\s\S]+?)\.?$/i,
  /^(?:please\s+)?make\s+([\s\S]+?)\s+say\s+([\s\S]+?)\.?$/i,
]

function unquotePhrase(value: string): string {
  const trimmed = value.trim()
  const quoted = trimmed.match(/^["'“]([\s\S]*)["'”]$/)
  return quoted?.[1] ?? trimmed
}

/**
 * Apply "change X to Y", "replace X with Y", or "make X say Y" when X is in the post.
 * Returns null when the instruction is not that shape or X is missing, so the caller
 * can send it to the revise model.
 */
export function literalReplacement(
  post: ReviewPost,
  instruction: string,
): { text: string; entries: string[] | null } | null {
  const trimmed = instruction.trim()
  let from = ''
  let to = ''
  for (const pattern of LITERAL_EDIT) {
    const match = trimmed.match(pattern)
    if (!match) continue
    from = unquotePhrase(match[1] ?? '')
    to = unquotePhrase(match[2] ?? '')
    break
  }
  if (!from || !post.text.includes(from)) return null
  const text = post.text.split(from).join(to)
  if (!post.entries) return { text, entries: null }
  const entries = post.entries.map((entry) => (entry.includes(from) ? entry.split(from).join(to) : entry))
  if (entries.join('\n\n') === text) return { text, entries }
  return { text, entries: text.split('\n\n') }
}

export function refineInstruction(post: ReviewPost, instruction: string): string {
  const body = post.entries ? post.entries.map((entry, index) => `${index + 1}. ${entry}`).join('\n') : post.text
  return [
    `Revise only this ${post.platform} post. Return one replacement and no other posts.`,
    'Change only the words the instruction names. Add text only if the instruction asks to add it.',
    'Do not invent facts, hashtags, or bold suggestions.',
    'Do not change the subject. Do not schedule it.',
    '',
    'CURRENT POST:',
    body,
    '',
    'INSTRUCTION:',
    instruction.trim(),
  ].join('\n')
}
