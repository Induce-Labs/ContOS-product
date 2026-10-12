import { remoteStatusCode } from './devLog'
import { supabase } from './supabase'
import type { Tables } from '../types/database'
import type { CompetitorSummary } from '../types/contos'

export type ContentSummary = Tables<'instagram_content_summaries'>
export type LinkedInContentSummary = Tables<'linkedin_content_summaries'>
export type TwitterContentSummary = Tables<'twitter_content_summaries'>

/** Unified shape used by the dashboard for either platform. */
export type DashboardSummary = {
  competitor_id: string
  avatar_id: string
  summary: unknown
  model_used: string
  generated_at: string
  source: 'instagram' | 'linkedin' | 'twitter'
}

export class SummariesServiceError extends Error {
  readonly statusCode: number | null

  constructor(message: string, cause?: unknown, statusCode?: number | null) {
    super(message)
    this.name = 'SummariesServiceError'
    this.statusCode = remoteStatusCode(cause, statusCode)
    if (cause instanceof Error) {
      this.cause = cause
    }
  }
}

export async function fetchSummariesForAvatar(
  avatarId: string,
): Promise<ContentSummary[]> {
  const { data, error } = await supabase
    .from('instagram_content_summaries')
    .select('*')
    .eq('avatar_id', avatarId)
    .order('generated_at', { ascending: false })

  if (error) {
    throw new SummariesServiceError(
      `Failed to load Instagram content summaries: ${error.message}`,
      error,
    )
  }

  return data
}

/** @deprecated Use fetchSummariesForAvatar */
export const fetchSummariesForProject = fetchSummariesForAvatar

export async function fetchLinkedInSummariesForAvatar(
  avatarId: string,
): Promise<LinkedInContentSummary[]> {
  const { data, error } = await supabase
    .from('linkedin_content_summaries')
    .select('*')
    .eq('avatar_id', avatarId)
    .order('generated_at', { ascending: false })

  if (error) {
    throw new SummariesServiceError(
      `Failed to load LinkedIn content summaries: ${error.message}`,
      error,
    )
  }

  return data
}

/** @deprecated Use fetchLinkedInSummariesForAvatar */
export const fetchLinkedInSummariesForProject = fetchLinkedInSummariesForAvatar

export async function fetchTwitterSummariesForAvatar(
  avatarId: string,
): Promise<TwitterContentSummary[]> {
  const { data, error } = await supabase
    .from('twitter_content_summaries')
    .select('*')
    .eq('avatar_id', avatarId)
    .order('generated_at', { ascending: false })

  if (error) {
    throw new SummariesServiceError(
      `Failed to load Twitter content summaries: ${error.message}`,
      error,
    )
  }

  return data
}

export async function fetchAllSummariesForAvatar(
  avatarId: string,
): Promise<DashboardSummary[]> {
  const [instagram, linkedin, twitter] = await Promise.all([
    fetchSummariesForAvatar(avatarId),
    fetchLinkedInSummariesForAvatar(avatarId),
    fetchTwitterSummariesForAvatar(avatarId),
  ])

  return [
    ...instagram.map((row) => ({
      competitor_id: row.competitor_id,
      avatar_id: row.avatar_id,
      summary: row.summary,
      model_used: row.model_used,
      generated_at: row.generated_at,
      source: 'instagram' as const,
    })),
    ...linkedin.map((row) => ({
      competitor_id: row.competitor_id,
      avatar_id: row.avatar_id,
      summary: row.summary,
      model_used: row.model_used,
      generated_at: row.generated_at,
      source: 'linkedin' as const,
    })),
    ...twitter.map((row) => ({
      competitor_id: row.competitor_id,
      avatar_id: row.avatar_id,
      summary: row.summary,
      model_used: row.model_used,
      generated_at: row.generated_at,
      source: 'twitter' as const,
    })),
  ]
}

/** @deprecated Use fetchAllSummariesForAvatar */
export const fetchAllSummariesForProject = fetchAllSummariesForAvatar

export function parseCompetitorSummary(summary: unknown): CompetitorSummary | null {
  if (typeof summary !== 'object' || summary === null) {
    return null
  }

  const payload = summary as CompetitorSummary

  if (
    !Array.isArray(payload.top_performing_content) ||
    !Array.isArray(payload.recurring_hooks_patterns) ||
    !Array.isArray(payload.content_strategies_themes) ||
    !Array.isArray(payload.strategic_signals) ||
    typeof payload.aggregated_engagement_metrics !== 'object' ||
    payload.aggregated_engagement_metrics === null
  ) {
    return null
  }

  return payload
}
