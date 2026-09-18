import { supabase } from './supabase'
import type { Tables, TablesInsert } from '../types/database'
import type { CompetitorPlatform } from '../types/contos'
import { getInstagramHandle } from './instagram'
import { getLinkedInSlug } from './linkedin'
import { getTwitterHandle } from './twitter'

export type Competitor = Tables<'competitors'>

export const MAX_COMPETITORS_PER_AVATAR = 10
export const MIN_COMPETITORS_PER_AVATAR = 1
export const RECOMMENDED_COMPETITORS_PER_AVATAR = 5

export class CompetitorsServiceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'CompetitorsServiceError'
    if (cause instanceof Error) {
      this.cause = cause
    }
  }
}

function competitorIdentityKey(platform: CompetitorPlatform, handleOrUrl: string): string {
  if (platform === 'linkedin') {
    return `linkedin:${getLinkedInSlug(handleOrUrl)}`
  }
  if (platform === 'twitter') {
    return `twitter:${getTwitterHandle(handleOrUrl)}`
  }

  return `instagram:${getInstagramHandle(handleOrUrl)}`
}

export async function fetchCompetitorsForAvatar(avatarId: string): Promise<Competitor[]> {
  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('avatar_id', avatarId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new CompetitorsServiceError(
      `Failed to load competitors: ${error.message}`,
      error,
    )
  }

  return data
}

/** @deprecated Use fetchCompetitorsForAvatar */
export const fetchCompetitorsForProject = fetchCompetitorsForAvatar

export async function createCompetitors(
  avatarId: string,
  handleOrUrls: string[],
  platform: CompetitorPlatform = 'instagram',
): Promise<Competitor[]> {
  if (handleOrUrls.length < MIN_COMPETITORS_PER_AVATAR) {
    throw new CompetitorsServiceError(
      `At least ${MIN_COMPETITORS_PER_AVATAR} competitor is required.`,
    )
  }

  const existingCompetitors = await fetchCompetitorsForAvatar(avatarId)

  const existingByKey = new Map(
    existingCompetitors.map((competitor) => [
      competitorIdentityKey(
        competitor.platform as CompetitorPlatform,
        competitor.handle_or_url,
      ),
      competitor,
    ]),
  )

  const reused: Competitor[] = []
  const toInsert: string[] = []
  const seenInRequest = new Set<string>()

  for (const handleOrUrl of handleOrUrls) {
    const key = competitorIdentityKey(platform, handleOrUrl)
    if (seenInRequest.has(key)) {
      continue
    }
    seenInRequest.add(key)

    const already = existingByKey.get(key)
    if (already) {
      reused.push(already)
      continue
    }
    toInsert.push(handleOrUrl)
  }

  if (existingCompetitors.length + toInsert.length > MAX_COMPETITORS_PER_AVATAR) {
    const remainingSlots = MAX_COMPETITORS_PER_AVATAR - existingCompetitors.length
    throw new CompetitorsServiceError(
      remainingSlots <= 0
        ? `This avatar already has the maximum of ${MAX_COMPETITORS_PER_AVATAR} competitors.`
        : `You can add at most ${remainingSlots} more competitor(s) to this avatar.`,
    )
  }

  if (toInsert.length === 0) {
    return reused
  }

  const rows: TablesInsert<'competitors'>[] = toInsert.map((handleOrUrl) => ({
    avatar_id: avatarId,
    platform,
    handle_or_url: handleOrUrl,
    scrape_status: 'pending',
    pipeline_step: 'queued',
  }))

  const { data, error } = await supabase.from('competitors').insert(rows).select()

  if (error) {
    throw new CompetitorsServiceError(mapCompetitorCapError(error.message), error)
  }

  return [...reused, ...data]
}

export function failedCompetitorIds(competitors: Competitor[]): string[] {
  return competitors
    .filter((competitor) => competitor.pipeline_step === 'failed')
    .map((competitor) => competitor.id)
}

export async function deleteCompetitor(competitorId: string): Promise<void> {
  const { error } = await supabase.from('competitors').delete().eq('id', competitorId)

  if (error) {
    throw new CompetitorsServiceError(
      `Failed to delete competitor: ${error.message}`,
      error,
    )
  }
}

export async function deleteCompetitors(competitorIds: string[]): Promise<void> {
  if (competitorIds.length === 0) {
    return
  }

  const { error } = await supabase.from('competitors').delete().in('id', competitorIds)

  if (error) {
    throw new CompetitorsServiceError(
      `Failed to delete competitors: ${error.message}`,
      error,
    )
  }
}

function mapCompetitorCapError(message: string): string {
  if (message.includes('competitor_cap_exceeded')) {
    return 'This avatar already has the maximum of 10 competitors.'
  }

  return message
}
