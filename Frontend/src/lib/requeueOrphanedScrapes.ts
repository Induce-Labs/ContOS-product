/**
 * Re-enqueue competitor scrape jobs that look abandoned in Supabase
 * (still pending/queued) while Celery/Redis may have lost the task.
 */
import { enqueueCompetitorScrapeJobs } from './api'
import type { Competitor } from './competitors'

const ORPHAN_AGE_MS = 90_000
const SESSION_KEY_PREFIX = 'contos_scrape_requeue:'

function isOrphanedPending(competitor: Competitor, nowMs: number): boolean {
  const status = (competitor.scrape_status || '').toLowerCase()
  const step = (competitor.pipeline_step || '').toLowerCase()
  if (status !== 'pending') {
    return false
  }
  if (step !== 'queued' && step !== '' && step !== 'pending') {
    return false
  }
  const created = Date.parse(competitor.created_at)
  if (Number.isNaN(created)) {
    return true
  }
  return nowMs - created >= ORPHAN_AGE_MS
}

function sessionKey(projectId: string, competitorIds: string[]): string {
  return `${SESSION_KEY_PREFIX}${projectId}:${[...competitorIds].sort().join(',')}`
}

/**
 * Once per browser session per id set, re-publish Celery tasks for orphaned
 * pending competitors. Safe to call from dashboard polling; failures are logged.
 */
export async function requeueOrphanedCompetitorScrapes(
  projectId: string,
  competitors: Competitor[],
): Promise<string[]> {
  const nowMs = Date.now()
  const orphanIds = competitors
    .filter((competitor) => isOrphanedPending(competitor, nowMs))
    .map((competitor) => competitor.id)

  if (orphanIds.length === 0) {
    return []
  }

  const key = sessionKey(projectId, orphanIds)
  try {
    if (sessionStorage.getItem(key) === '1') {
      return []
    }
    sessionStorage.setItem(key, '1')
  } catch {
    // private mode — still attempt one requeue this call
  }

  try {
    await enqueueCompetitorScrapeJobs(projectId, orphanIds)
    return orphanIds
  } catch (error) {
    try {
      sessionStorage.removeItem(key)
    } catch {
      // ignore
    }
    console.warn('Failed to requeue orphaned competitor scrapes', {
      projectId,
      orphanIds,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}
