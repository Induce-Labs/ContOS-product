import { PostizApiError, localDateTimeToOffsetIso, monthBoundsAsOffsetIso, type PostizCalendarPost } from './postiz'
import {
  normalizeDraftText,
  scheduleSkipReason,
  type ReviewPost,
  type ReviewStatus,
} from './reviewableDrafts'

export type ScheduleOutcome = 'succeeded' | 'failed' | 'skipped' | 'uncertain'

export type ScheduleRow = {
  post: ReviewPost
  outcome: ScheduleOutcome
  reason: string
}

type ListedPost = Pick<PostizCalendarPost, 'id' | 'content' | 'state'>

export function isAmbiguousPostizError(error: unknown): boolean {
  if (error instanceof PostizApiError) {
    return error.statusCode == null || error.statusCode >= 500
  }
  if (error instanceof TypeError) return true
  return false
}

export function createdPostId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (typeof record.id === 'string' && record.id.trim()) return record.id.trim()
  const post = record.post
  if (post && typeof post === 'object' && typeof (post as { id?: unknown }).id === 'string') {
    const id = (post as { id: string }).id.trim()
    if (id) return id
  }
  const posts = record.posts
  if (Array.isArray(posts) && posts[0] && typeof posts[0] === 'object') {
    const id = (posts[0] as { id?: unknown }).id
    if (typeof id === 'string' && id.trim()) return id.trim()
  }
  return null
}

export function matchListedPost(
  posts: ListedPost[],
  content: string,
): { kind: 'none' } | { kind: 'one'; id: string; state: string } | { kind: 'many' } {
  const wanted = normalizeDraftText(content)
  const hits = posts.filter((post) => normalizeDraftText(post.content) === wanted)
  if (hits.length === 0) return { kind: 'none' }
  if (hits.length > 1) return { kind: 'many' }
  return { kind: 'one', id: hits[0].id, state: hits[0].state }
}

export function statusFromPostizState(state: string): ReviewStatus {
  const normalized = state.trim().toUpperCase()
  if (normalized === 'DRAFT') return 'draft'
  if (normalized === 'QUEUE' || normalized === 'SCHEDULED') return 'scheduled'
  if (normalized === 'PUBLISHED' || normalized === 'RELEASED') return 'published'
  if (normalized === 'ERROR' || normalized === 'FAILED') return 'failed'
  return 'uncertain'
}

function dayWindow(localDateTime: string): { startDate: string; endDate: string } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T/.exec(localDateTime.trim())
  if (!match) return null
  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  if (!Number.isInteger(year) || monthIndex < 0 || monthIndex > 11 || day < 1) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  try {
    return {
      startDate: localDateTimeToOffsetIso(`${year}-${pad(monthIndex + 1)}-${pad(day)}T00:00`),
      endDate: localDateTimeToOffsetIso(`${year}-${pad(monthIndex + 1)}-${pad(day)}T23:59`),
    }
  } catch {
    return monthBoundsAsOffsetIso(year, monthIndex)
  }
}

function adopt(post: ReviewPost, id: string, state: string): ReviewPost {
  const status = statusFromPostizState(state)
  return {
    ...post,
    postizPostId: id,
    status: status === 'uncertain' ? 'scheduled' : status,
    statusDetail: null,
  }
}

export function postizRequestFromReview(
  post: ReviewPost,
  publishDate: string,
  mode: 'draft' | 'schedule',
): {
  type: 'draft' | 'schedule' | 'update'
  content: string
  publishDate: string
  postId?: string
  platform: 'linkedin' | 'x'
  posts?: Array<{ content: string }>
  images: ReviewPost['media']
  threadUpdateLimited: boolean
} | null {
  if (post.platform === 'instagram') return null
  const entries = post.entries?.map((entry) => entry.trim()).filter(Boolean) ?? []
  const content = (entries[0] ?? post.text).trim()
  if (!content) return null
  const updating = Boolean(post.postizPostId)
  return {
    type: updating ? 'update' : mode,
    content,
    publishDate,
    postId: updating ? post.postizPostId ?? undefined : undefined,
    platform: post.platform,
    posts:
      post.platform === 'x' && entries.length > 0 && !updating
        ? entries.map((entry) => ({ content: entry }))
        : undefined,
    images: post.media,
    threadUpdateLimited: updating && entries.length > 1,
  }
}

export async function commitReviewPost(input: {
  post: ReviewPost
  localDateTime: string
  now: Date
  mode: 'draft' | 'schedule'
  create: (post: ReviewPost, publishDate: string, mode: 'draft' | 'schedule') => Promise<unknown>
  list: (startDate: string, endDate: string) => Promise<ListedPost[]>
}): Promise<ScheduleRow> {
  const { post, localDateTime, now, mode } = input
  const when = mode === 'draft' ? futureOrFallback(localDateTime, now) : localDateTime
  const skip = scheduleSkipReason(post, when, now)
  if (skip) return { post, outcome: 'skipped', reason: skip }
  let publishDate: string
  try {
    publishDate = localDateTimeToOffsetIso(when)
  } catch (error) {
    return {
      post,
      outcome: 'skipped',
      reason: error instanceof Error ? error.message : 'invalid',
    }
  }

  const reconcile = async (): Promise<ScheduleRow | null> => {
    const window = dayWindow(when)
    if (!window) return { post, outcome: 'uncertain', reason: 'invalid-window' }
    try {
      const listed = await input.list(window.startDate, window.endDate)
      const match = matchListedPost(listed, post.entries?.[0] ?? post.text)
      if (match.kind === 'one') {
        return { post: adopt(post, match.id, match.state), outcome: 'succeeded', reason: 'reconciled' }
      }
      if (match.kind === 'many') {
        return { post: { ...post, status: 'uncertain', statusDetail: 'many' }, outcome: 'uncertain', reason: 'many' }
      }
      return null
    } catch (error) {
      return {
        post: { ...post, status: 'uncertain', statusDetail: 'list-failed' },
        outcome: 'uncertain',
        reason: error instanceof Error ? error.message : 'list-failed',
      }
    }
  }

  if (post.status === 'uncertain') {
    const found = await reconcile()
    if (found) return found
  }

  try {
    const payload = await input.create(post, publishDate, mode)
    const id = createdPostId(payload) ?? post.postizPostId
    if (id) {
      return {
        post: {
          ...post,
          postizPostId: id,
          status: mode === 'draft' ? 'draft' : 'scheduled',
          statusDetail: null,
        },
        outcome: 'succeeded',
        reason: mode,
      }
    }
    const found = await reconcile()
    if (found?.outcome === 'succeeded') return found
    return {
      post: { ...post, status: 'uncertain', statusDetail: 'missing-id' },
      outcome: 'uncertain',
      reason: 'missing-id',
    }
  } catch (error) {
    if (!isAmbiguousPostizError(error)) {
      return {
        post: { ...post, status: 'failed', statusDetail: error instanceof Error ? error.message : 'failed' },
        outcome: 'failed',
        reason: error instanceof Error ? error.message : 'failed',
      }
    }
    const found = await reconcile()
    if (found) return found
    return {
      post: { ...post, status: 'uncertain', statusDetail: 'timeout' },
      outcome: 'uncertain',
      reason: 'timeout',
    }
  }
}

function futureOrFallback(localDateTime: string, now: Date): string {
  const trimmed = localDateTime.trim()
  if (LOCAL_READY.test(trimmed)) {
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()) return trimmed
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  const next = new Date(now.getTime() + 60 * 60 * 1000)
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:${pad(next.getMinutes())}`
}

const LOCAL_READY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export async function commitReviewPosts(input: {
  posts: Array<{ post: ReviewPost; localDateTime: string }>
  now: Date
  mode: 'draft' | 'schedule'
  create: (post: ReviewPost, publishDate: string, mode: 'draft' | 'schedule') => Promise<unknown>
  list: (startDate: string, endDate: string) => Promise<ListedPost[]>
}): Promise<Record<ScheduleOutcome, ScheduleRow[]>> {
  const report: Record<ScheduleOutcome, ScheduleRow[]> = {
    succeeded: [],
    failed: [],
    skipped: [],
    uncertain: [],
  }
  const seen = new Set<string>()
  for (const item of input.posts) {
    if (seen.has(item.post.id)) {
      report.skipped.push({ post: item.post, outcome: 'skipped', reason: 'duplicate' })
      continue
    }
    seen.add(item.post.id)
    if (input.mode === 'schedule' && (item.post.status === 'scheduled' || item.post.status === 'published')) {
      report.skipped.push({ post: item.post, outcome: 'skipped', reason: 'already_scheduled' })
      continue
    }
    const row = await commitReviewPost({
      post: item.post,
      localDateTime: item.localDateTime,
      now: input.now,
      mode: input.mode,
      create: input.create,
      list: input.list,
    })
    report[row.outcome].push(row)
  }
  return report
}
