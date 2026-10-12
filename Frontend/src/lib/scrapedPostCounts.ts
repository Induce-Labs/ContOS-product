import { supabase } from './supabase'
import { SummariesServiceError } from './summaries'

const SCRAPED_POST_TABLES = [
  'instagram_scraped_content',
  'linkedin_scraped_content',
  'twitter_scraped_content',
] as const

/** Exact scraped-row counts for competitors that have no stored summary. */
export async function fetchScrapedPostCounts(
  competitorIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (competitorIds.length === 0) {
    return counts
  }

  await Promise.all(
    competitorIds.map(async (competitorId) => {
      let total = 0

      for (const table of SCRAPED_POST_TABLES) {
        const { count, error } = await supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .eq('competitor_id', competitorId)

        if (error || count === null) {
          throw new SummariesServiceError(
            `Failed to count scraped posts in ${table} for competitor ${competitorId}: ${error?.message ?? 'count was null'}`,
            error,
          )
        }

        total += count
      }

      counts.set(competitorId, total)
    }),
  )

  return counts
}
