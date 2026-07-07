import { supabase, getApiBaseUrl } from './supabase'

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

export async function enqueueCompetitorScrapeJobs(
  projectId: string,
  competitorIds: string[],
): Promise<void> {
  if (competitorIds.length === 0) {
    return
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) {
    throw new ApiServiceError(`Failed to read auth session: ${sessionError.message}`)
  }

  if (!session?.access_token) {
    throw new ApiServiceError('You must be signed in to start competitor research.')
  }

  const response = await fetch(
    `${getApiBaseUrl()}/projects/${projectId}/competitors/scrape`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ competitor_ids: competitorIds }),
    },
  )

  if (!response.ok) {
    const responseBody = await response.text()
    throw new ApiServiceError(
      `Failed to enqueue scrape jobs (status ${response.status}): ${responseBody || 'no response body'}`,
      response.status,
    )
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
  projectId: string,
  competitorIds: string[],
): void {
  void enqueueCompetitorScrapeJobs(projectId, competitorIds).catch((error: unknown) => {
    console.warn('Failed to enqueue competitor scrape jobs in background', {
      projectId,
      competitorIds,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

/** Prefer this over the background helper when the UI should surface enqueue failures. */
export async function enqueueCompetitorScrapeJobsOrThrow(
  projectId: string,
  competitorIds: string[],
): Promise<void> {
  await enqueueCompetitorScrapeJobs(projectId, competitorIds)
}
