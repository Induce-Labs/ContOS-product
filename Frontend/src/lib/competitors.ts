import { supabase } from './supabase'
import type { Tables, TablesInsert } from '../types/database'
import type { CompetitorPlatform } from '../types/contos'
import { getInstagramHandle } from './instagram'
import { getLinkedInSlug } from './linkedin'

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

  if (existingCompetitors.length + handleOrUrls.length > MAX_COMPETITORS_PER_AVATAR) {
    const remainingSlots = MAX_COMPETITORS_PER_AVATAR - existingCompetitors.length
    throw new CompetitorsServiceError(
      remainingSlots <= 0
        ? `This avatar already has the maximum of ${MAX_COMPETITORS_PER_AVATAR} competitors.`
        : `You can add at most ${remainingSlots} more competitor(s) to this avatar.`,
    )
  }

  const existingKeys = new Set(
    existingCompetitors.map((competitor) =>
      competitorIdentityKey(
        competitor.platform as CompetitorPlatform,
        competitor.handle_or_url,
      ),
    ),
  )

  for (const handleOrUrl of handleOrUrls) {
    const key = competitorIdentityKey(platform, handleOrUrl)
    if (existingKeys.has(key)) {
      throw new CompetitorsServiceError(
        platform === 'linkedin'
          ? `${getLinkedInSlug(handleOrUrl)} is already tracked on this avatar.`
          : `@${getInstagramHandle(handleOrUrl)} is already tracked on this avatar.`,
      )
    }
    existingKeys.add(key)
  }

  if (handleOrUrls.length > MAX_COMPETITORS_PER_AVATAR) {
    throw new CompetitorsServiceError(
      `An avatar can have at most ${MAX_COMPETITORS_PER_AVATAR} competitors.`,
    )
  }

  const rows: TablesInsert<'competitors'>[] = handleOrUrls.map((handleOrUrl) => ({
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

  return data
}

function mapCompetitorCapError(message: string): string {
  if (message.includes('competitor_cap_exceeded')) {
    return 'This avatar already has the maximum of 10 competitors.'
  }

  return message
}
