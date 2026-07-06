import { supabase } from './supabase'
import type { Tables } from '../types/database'
import type { CompetitorSummary } from '../types/contos'

export type ContentSummary = Tables<'content_summaries'>

export class SummariesServiceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'SummariesServiceError'
    if (cause instanceof Error) {
      this.cause = cause
    }
  }
}

export async function fetchSummariesForProject(
  projectId: string,
): Promise<ContentSummary[]> {
  const { data, error } = await supabase
    .from('content_summaries')
    .select('*')
    .eq('project_id', projectId)
    .order('generated_at', { ascending: false })

  if (error) {
    throw new SummariesServiceError(
      `Failed to load content summaries: ${error.message}`,
      error,
    )
  }

  return data
}

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
