import { getAccessToken } from './auth'
import { getApiBaseUrl } from './supabase'

export class PostizApiError extends Error {
  readonly statusCode: number | null

  constructor(message: string, statusCode: number | null = null) {
    super(message)
    this.name = 'PostizApiError'
    this.statusCode = statusCode
  }
}

export type PostizConnectResponse = {
  authorization_url: string
  flow: string
}

export type PostizIntegration = {
  id: string
  name: string
  identifier: string
  picture: string | null
}

export type PostizStatusResponse = {
  connected: boolean
  integration: PostizIntegration | null
  claim_candidates: PostizIntegration[]
}

function parseIntegration(value: unknown): PostizIntegration | null {
  if (value === null) {
    return null
  }
  if (typeof value !== 'object') {
    throw new PostizApiError('Postiz status returned an unexpected integration field.')
  }
  const item = value as {
    id?: unknown
    name?: unknown
    identifier?: unknown
    picture?: unknown
  }
  if (
    typeof item.id !== 'string' ||
    typeof item.name !== 'string' ||
    typeof item.identifier !== 'string'
  ) {
    throw new PostizApiError('Postiz status returned an unexpected integration body.')
  }
  if (item.picture != null && typeof item.picture !== 'string') {
    throw new PostizApiError('Postiz status returned an unexpected integration picture.')
  }
  return {
    id: item.id,
    name: item.name,
    identifier: item.identifier,
    picture: item.picture ?? null,
  }
}

function parseClaimCandidates(value: unknown): PostizIntegration[] {
  if (value === undefined || value === null) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new PostizApiError(
      'Postiz status returned an unexpected claim_candidates field.',
    )
  }
  return value.map((item, index) => {
    const parsed = parseIntegration(item)
    if (parsed === null) {
      throw new PostizApiError(
        `Postiz status returned an unexpected claim candidate at index ${index}.`,
      )
    }
    return parsed
  })
}

function parseStatusResponse(data: unknown, context: string): PostizStatusResponse {
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as PostizStatusResponse).connected !== 'boolean'
  ) {
    throw new PostizApiError(`Postiz ${context} returned an unexpected response body.`)
  }

  return {
    connected: (data as PostizStatusResponse).connected,
    integration: parseIntegration((data as { integration?: unknown }).integration),
    claim_candidates: parseClaimCandidates(
      (data as { claim_candidates?: unknown }).claim_candidates,
    ),
  }
}

async function requireAccessToken(): Promise<string> {
  try {
    return await getAccessToken()
  } catch (error: unknown) {
    throw new PostizApiError(
      error instanceof Error ? error.message : 'You must be signed in to continue.',
    )
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  const bodyText = await response.text()
  if (!bodyText) {
    return `Request failed with status ${response.status}`
  }

  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'detail' in parsed &&
      typeof (parsed as { detail: unknown }).detail === 'string'
    ) {
      return (parsed as { detail: string }).detail
    }
  } catch {
    // Use raw text below.
  }

  return bodyText
}

function requireAvatarId(avatarId: string): string {
  const trimmed = avatarId.trim()
  if (!trimmed) {
    throw new PostizApiError('avatar_id is required for Postiz operations.')
  }
  return trimmed
}

export async function getPostizStatus(avatarId: string): Promise<PostizStatusResponse> {
  const accessToken = await requireAccessToken()
  const id = requireAvatarId(avatarId)
  const url = new URL(`${getApiBaseUrl()}/api/postiz/status`)
  url.searchParams.set('avatar_id', id)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new PostizApiError(await readErrorDetail(response), response.status)
  }

  return parseStatusResponse(await response.json(), 'status')
}

export async function claimPostizIntegration(
  avatarId: string,
  integrationId: string,
): Promise<PostizStatusResponse> {
  const accessToken = await requireAccessToken()
  const id = requireAvatarId(avatarId)
  const response = await fetch(`${getApiBaseUrl()}/api/postiz/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ avatar_id: id, integration_id: integrationId }),
  })

  if (!response.ok) {
    throw new PostizApiError(await readErrorDetail(response), response.status)
  }

  return parseStatusResponse(await response.json(), 'claim')
}

export async function startPostizConnect(avatarId: string): Promise<PostizConnectResponse> {
  const accessToken = await requireAccessToken()
  const id = requireAvatarId(avatarId)
  const url = new URL(`${getApiBaseUrl()}/api/postiz/connect`)
  url.searchParams.set('avatar_id', id)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new PostizApiError(await readErrorDetail(response), response.status)
  }

  const data: unknown = await response.json()
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as PostizConnectResponse).authorization_url !== 'string' ||
    typeof (data as PostizConnectResponse).flow !== 'string'
  ) {
    throw new PostizApiError('Postiz connect returned an unexpected response body.')
  }

  return {
    authorization_url: (data as PostizConnectResponse).authorization_url,
    flow: (data as PostizConnectResponse).flow,
  }
}

export type PostizPostType = 'now' | 'schedule' | 'draft' | 'update'
export type PostizPostStatus = 'draft' | 'schedule'

export const POSTIZ_MAX_POST_IMAGES = 10
/** Mirrors ContOS backend `_MAX_VIDEO_BYTES` (1 GB). Frontend UX guard only. */
export const POSTIZ_MAX_VIDEO_BYTES = 1024 * 1024 * 1024
export const POSTIZ_VIDEO_MIME = 'video/mp4'

export type PostizMediaItem = {
  id: string
  path: string
  alt: string | null
  thumbnail: string | null
  name: string | null
  original_name: string | null
}

export type PostizCalendarPost = {
  id: string
  content: string
  publish_date: string
  state: string
  group: string | null
  release_url: string | null
  integration_id: string
  integration_name: string | null
  images: PostizMediaItem[]
}

export type PostizDisconnectResponse = {
  disconnected: boolean
  warning: string
}

function parseMediaItem(value: unknown, index: number): PostizMediaItem {
  if (typeof value !== 'object' || value === null) {
    throw new PostizApiError(`Postiz media item at index ${index} is invalid.`)
  }
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.path !== 'string') {
    throw new PostizApiError(`Postiz media item at index ${index} is missing id/path.`)
  }
  // ContOS API uses snake_case; raw Postiz bodies use camelCase originalName.
  const originalName =
    typeof item.original_name === 'string'
      ? item.original_name
      : typeof item.originalName === 'string'
        ? item.originalName
        : null
  return {
    id: item.id,
    path: item.path,
    alt: typeof item.alt === 'string' ? item.alt : null,
    thumbnail: typeof item.thumbnail === 'string' ? item.thumbnail : null,
    name: typeof item.name === 'string' ? item.name : null,
    original_name: originalName,
  }
}

function parseCalendarPost(value: unknown, index: number): PostizCalendarPost {
  if (typeof value !== 'object' || value === null) {
    throw new PostizApiError(`Postiz posts returned an unexpected item at index ${index}.`)
  }
  const item = value as Record<string, unknown>
  if (
    typeof item.id !== 'string' ||
    typeof item.content !== 'string' ||
    typeof item.publish_date !== 'string' ||
    typeof item.state !== 'string' ||
    typeof item.integration_id !== 'string'
  ) {
    throw new PostizApiError(`Postiz posts returned an unexpected item at index ${index}.`)
  }
  if (item.group != null && typeof item.group !== 'string') {
    throw new PostizApiError(`Postiz posts returned an unexpected group at index ${index}.`)
  }
  if (item.release_url != null && typeof item.release_url !== 'string') {
    throw new PostizApiError(
      `Postiz posts returned an unexpected release_url at index ${index}.`,
    )
  }
  if (item.integration_name != null && typeof item.integration_name !== 'string') {
    throw new PostizApiError(
      `Postiz posts returned an unexpected integration_name at index ${index}.`,
    )
  }
  const imagesRaw = item.images
  if (imagesRaw != null && !Array.isArray(imagesRaw)) {
    throw new PostizApiError(`Postiz posts returned unexpected images at index ${index}.`)
  }
  return {
    id: item.id,
    content: item.content,
    publish_date: item.publish_date,
    state: item.state,
    group: typeof item.group === 'string' ? item.group : null,
    release_url: typeof item.release_url === 'string' ? item.release_url : null,
    integration_id: item.integration_id,
    integration_name:
      typeof item.integration_name === 'string' ? item.integration_name : null,
    images: Array.isArray(imagesRaw) ? imagesRaw.map(parseMediaItem) : [],
  }
}

/**
 * Build an ISO-8601 datetime with the browser's local offset.
 * Does not convert the wall-clock time to UTC — Postiz stores dayjs(date).toDate().
 */
export function localDateTimeToOffsetIso(localDateTime: string): string {
  const trimmed = localDateTime.trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed)) {
    throw new PostizApiError(
      `publish_date must be a local datetime (YYYY-MM-DDTHH:mm). Got: ${trimmed}`,
    )
  }
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) {
    throw new PostizApiError(`publish_date is not a valid local datetime: ${trimmed}`)
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  const year = parsed.getFullYear()
  const month = pad(parsed.getMonth() + 1)
  const day = pad(parsed.getDate())
  const hours = pad(parsed.getHours())
  const minutes = pad(parsed.getMinutes())
  const seconds = pad(parsed.getSeconds())
  const offsetMinutes = -parsed.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const abs = Math.abs(offsetMinutes)
  const offsetHours = pad(Math.floor(abs / 60))
  const offsetMins = pad(abs % 60)
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMins}`
}

export function nowAsOffsetIso(): string {
  return localDateTimeToOffsetIso(
    (() => {
      const d = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    })(),
  )
}

export function monthBoundsAsOffsetIso(
  year: number,
  monthIndex: number,
): { startDate: string; endDate: string } {
  const pad = (n: number) => String(n).padStart(2, '0')
  const lastDay = new Date(year, monthIndex + 1, 0).getDate()
  const startLocal = `${year}-${pad(monthIndex + 1)}-01T00:00`
  const endLocal = `${year}-${pad(monthIndex + 1)}-${pad(lastDay)}T23:59`
  return {
    startDate: localDateTimeToOffsetIso(startLocal),
    endDate: localDateTimeToOffsetIso(endLocal),
  }
}

export function isoToLocalDateTimeInput(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) {
    throw new PostizApiError(`Cannot parse publish_date for editing: ${iso}`)
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

export async function listPostizPosts(
  avatarId: string,
  startDate: string,
  endDate: string,
): Promise<PostizCalendarPost[]> {
  const accessToken = await requireAccessToken()
  const id = requireAvatarId(avatarId)
  const url = new URL(`${getApiBaseUrl()}/api/postiz/posts`)
  url.searchParams.set('avatar_id', id)
  url.searchParams.set('start_date', startDate)
  url.searchParams.set('end_date', endDate)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new PostizApiError(await readErrorDetail(response), response.status)
  }

  const data: unknown = await response.json()
  if (typeof data !== 'object' || data === null || !Array.isArray((data as { posts?: unknown }).posts)) {
    throw new PostizApiError('Postiz posts list returned an unexpected response body.')
  }
  return ((data as { posts: unknown[] }).posts).map(parseCalendarPost)
}

export async function createPostizPost(input: {
  avatarId: string
  type: PostizPostType
  content: string
  publishDate: string
  postId?: string
  images?: Array<{ id: string; path: string; alt?: string | null; thumbnail?: string | null }>
}): Promise<unknown> {
  const accessToken = await requireAccessToken()
  const id = requireAvatarId(input.avatarId)
  const response = await fetch(`${getApiBaseUrl()}/api/postiz/posts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      avatar_id: id,
      type: input.type,
      content: input.content,
      publish_date: input.publishDate,
      post_id: input.postId ?? null,
      images: (input.images ?? []).map((image) => ({
        id: image.id,
        path: image.path,
        ...(image.alt ? { alt: image.alt } : {}),
        ...(image.thumbnail ? { thumbnail: image.thumbnail } : {}),
      })),
    }),
  })

  if (!response.ok) {
    throw new PostizApiError(await readErrorDetail(response), response.status)
  }
  return response.json()
}

export async function uploadPostizMedia(
  avatarId: string,
  file: File,
): Promise<PostizMediaItem> {
  const accessToken = await requireAccessToken()
  const id = requireAvatarId(avatarId)
  const url = new URL(`${getApiBaseUrl()}/api/postiz/upload`)
  url.searchParams.set('avatar_id', id)
  const body = new FormData()
  body.append('file', file)

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body,
  })

  if (!response.ok) {
    throw new PostizApiError(await readErrorDetail(response), response.status)
  }
  // ContOS returns 200 with MediaItemResponse; Postiz upstream often used 201.
  // response.ok is true for both 200–299 — never treat 201 as failure here.
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new PostizApiError(
      `Upload response was not JSON (HTTP ${response.status}).`,
      response.status,
    )
  }
  try {
    return parseMediaItem(payload, 0)
  } catch (error) {
    const keys =
      typeof payload === 'object' && payload !== null
        ? Object.keys(payload as Record<string, unknown>).join(',')
        : typeof payload
    throw new PostizApiError(
      error instanceof PostizApiError
        ? `${error.message} (HTTP ${response.status}, keys=${keys})`
        : `Upload response parse failed (HTTP ${response.status}, keys=${keys})`,
      response.status,
    )
  }
}

export async function changePostizPostStatus(
  avatarId: string,
  postId: string,
  status: PostizPostStatus,
): Promise<unknown> {
  const accessToken = await requireAccessToken()
  const id = requireAvatarId(avatarId)
  const response = await fetch(
    `${getApiBaseUrl()}/api/postiz/posts/${encodeURIComponent(postId)}/status`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ avatar_id: id, status }),
    },
  )

  if (!response.ok) {
    throw new PostizApiError(await readErrorDetail(response), response.status)
  }
  return response.json()
}

export async function deletePostizPost(avatarId: string, postId: string): Promise<unknown> {
  const accessToken = await requireAccessToken()
  const id = requireAvatarId(avatarId)
  const url = new URL(
    `${getApiBaseUrl()}/api/postiz/posts/${encodeURIComponent(postId)}`,
  )
  url.searchParams.set('avatar_id', id)

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new PostizApiError(await readErrorDetail(response), response.status)
  }
  return response.json()
}

export async function disconnectPostizIntegration(
  avatarId: string,
): Promise<PostizDisconnectResponse> {
  const accessToken = await requireAccessToken()
  const id = requireAvatarId(avatarId)
  const url = new URL(`${getApiBaseUrl()}/api/postiz/integration`)
  url.searchParams.set('avatar_id', id)

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new PostizApiError(await readErrorDetail(response), response.status)
  }

  const data: unknown = await response.json()
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as PostizDisconnectResponse).disconnected !== 'boolean' ||
    typeof (data as PostizDisconnectResponse).warning !== 'string'
  ) {
    throw new PostizApiError('Postiz disconnect returned an unexpected response body.')
  }
  return {
    disconnected: (data as PostizDisconnectResponse).disconnected,
    warning: (data as PostizDisconnectResponse).warning,
  }
}
