import { getAccessToken } from './auth'
import { logDevError, remoteStatusCode } from './devLog'
import { getApiBaseUrl } from './supabase'

export class ApiServiceError extends Error {
  readonly statusCode: number | null

  constructor(message: string, statusCode: number | null = null) {
    super(message)
    this.name = 'ApiServiceError'
    this.statusCode = statusCode
  }
}

type EnqueueScrapeResponse = {
  status: string
  competitor_ids: string[]
}

async function requireAccessToken(): Promise<string> {
  try {
    return await getAccessToken()
  } catch (error: unknown) {
    throw new ApiServiceError(
      error instanceof Error ? error.message : 'You must be signed in to continue.',
      error instanceof Error ? remoteStatusCode(error) : null,
    )
  }
}

export async function enqueueCompetitorScrapeJobs(
  avatarId: string,
  competitorIds: string[],
): Promise<void> {
  if (competitorIds.length === 0) {
    return
  }

  const accessToken = await requireAccessToken()

  const response = await fetch(
    `${getApiBaseUrl()}/avatars/${avatarId}/competitors/scrape`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ competitor_ids: competitorIds }),
    },
  )

  if (!response.ok) {
    const responseBody = await response.text()
    const detail = `Failed to enqueue scrape jobs (status ${response.status}): ${responseBody || 'no response body'}`
    logDevError('POST /avatars/competitors/scrape', {
      method: 'POST',
      path: '/avatars/competitors/scrape',
      status: response.status,
      error: detail,
    })
    throw new ApiServiceError(detail, response.status)
  }

  const data: unknown = await response.json()

  if (
    typeof data !== 'object' ||
    data === null ||
    !('status' in data) ||
    typeof (data as EnqueueScrapeResponse).status !== 'string'
  ) {
    throw new ApiServiceError('Scrape enqueue returned an unexpected response body')
  }
}

export function enqueueCompetitorScrapeJobsInBackground(
  avatarId: string,
  competitorIds: string[],
): void {
  void enqueueCompetitorScrapeJobs(avatarId, competitorIds).catch(() => {
    // enqueueCompetitorScrapeJobs already recorded the sanitized dev log.
  })
}

/** Prefer this over the background helper when the UI should surface enqueue failures. */
export async function enqueueCompetitorScrapeJobsOrThrow(
  avatarId: string,
  competitorIds: string[],
): Promise<void> {
  await enqueueCompetitorScrapeJobs(avatarId, competitorIds)
}

export async function stopCompetitorPipeline(
  avatarId: string,
  competitorId: string,
): Promise<void> {
  const accessToken = await requireAccessToken()

  const response = await fetch(
    `${getApiBaseUrl()}/avatars/${avatarId}/competitors/${competitorId}/stop`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )

  if (!response.ok) {
    const responseBody = await response.text()
    const detail = `Failed to stop research (status ${response.status}): ${responseBody || 'no response body'}`
    logDevError('POST /avatars/competitors/stop', {
      method: 'POST',
      path: '/avatars/competitors/stop',
      status: response.status,
      error: detail,
    })
    throw new ApiServiceError(detail, response.status)
  }
}
