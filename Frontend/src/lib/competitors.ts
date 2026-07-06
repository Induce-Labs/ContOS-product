import { supabase } from './supabase'
import type { Tables, TablesInsert } from '../types/database'
import type { CompetitorPlatform } from '../types/contos'

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
    throw new CompetitorsServiceError(
      `Failed to create competitors: ${error.message}`,
      error,
    )
  }

  return data
}
