import { supabase } from './supabase'
import type { Tables, TablesInsert } from '../types/database'
import type { CompetitorPlatform } from '../types/contos'
import { getInstagramHandle } from './instagram'
import { getLinkedInSlug } from './linkedin'

export type Competitor = Tables<'competitors'>

export const MAX_COMPETITORS_PER_PROJECT = 10
export const MIN_COMPETITORS_PER_PROJECT = 1
export const RECOMMENDED_COMPETITORS_PER_PROJECT = 5

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

export async function fetchCompetitorsForProject(projectId: string): Promise<Competitor[]> {
  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new CompetitorsServiceError(
      `Failed to load competitors: ${error.message}`,
      error,
    )
  }

  return data
}

export async function createCompetitors(
  projectId: string,
  handleOrUrls: string[],
  platform: CompetitorPlatform = 'instagram',
): Promise<Competitor[]> {
  if (handleOrUrls.length < MIN_COMPETITORS_PER_PROJECT) {
    throw new CompetitorsServiceError(
      `At least ${MIN_COMPETITORS_PER_PROJECT} competitor is required.`,
    )
  }

  const existingCompetitors = await fetchCompetitorsForProject(projectId)

  if (existingCompetitors.length + handleOrUrls.length > MAX_COMPETITORS_PER_PROJECT) {
    const remainingSlots = MAX_COMPETITORS_PER_PROJECT - existingCompetitors.length
    throw new CompetitorsServiceError(
      remainingSlots <= 0
        ? `This project already has the maximum of ${MAX_COMPETITORS_PER_PROJECT} competitors.`
        : `You can add at most ${remainingSlots} more competitor(s) to this project.`,
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
          ? `${getLinkedInSlug(handleOrUrl)} is already tracked in this project.`
          : `@${getInstagramHandle(handleOrUrl)} is already tracked in this project.`,
      )
    }
    existingKeys.add(key)
  }

  if (handleOrUrls.length > MAX_COMPETITORS_PER_PROJECT) {
    throw new CompetitorsServiceError(
      `A project can have at most ${MAX_COMPETITORS_PER_PROJECT} competitors.`,
    )
  }

  const rows: TablesInsert<'competitors'>[] = handleOrUrls.map((handleOrUrl) => ({
    project_id: projectId,
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
    return 'This project already has the maximum of 10 competitors.'
  }

  return message
}
