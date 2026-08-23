import { supabase } from './supabase'
import type { Json, Tables } from '../types/database'
import type { ProjectType } from '../types/contos'
import { fetchAvatar, type Avatar } from './avatars'

export type ProfilingQuestion = Tables<'profiling_questions'>

export class ProfilingServiceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ProfilingServiceError'
    if (cause instanceof Error) {
      this.cause = cause
    }
  }
}

export async function fetchProfilingQuestions(
  type: ProjectType,
): Promise<ProfilingQuestion[]> {
  const { data, error } = await supabase
    .from('profiling_questions')
    .select('*')
    .eq('type', type)
    .eq('is_active', true)
    .order('display_order', { ascending: true })

  if (error) {
    throw new ProfilingServiceError(
      `Failed to load profiling questions: ${error.message}`,
      error,
    )
  }

  return data
}

export function profilingDataToAnswers(
  profilingData: Json | null | undefined,
  questions: ProfilingQuestion[],
): Record<string, string> {
  const data =
    profilingData && typeof profilingData === 'object' && !Array.isArray(profilingData)
      ? (profilingData as Record<string, unknown>)
      : {}

  const answers: Record<string, string> = {}
  for (const question of questions) {
    const value = data[question.question_key]
    answers[question.question_key] = typeof value === 'string' ? value : ''
  }
  return answers
}

export async function upsertProfilingAnswer(
  avatarId: string,
  questionKey: string,
  answerText: string,
): Promise<Avatar> {
  const avatar = await fetchAvatar(avatarId)
  const existing =
    avatar.profiling_data &&
    typeof avatar.profiling_data === 'object' &&
    !Array.isArray(avatar.profiling_data)
      ? { ...(avatar.profiling_data as Record<string, Json>) }
      : {}

  const trimmed = answerText.trim()
  if (!trimmed) {
    throw new ProfilingServiceError('Answer cannot be empty.')
  }

  const profiling_data: Json = {
    ...existing,
    [questionKey]: trimmed,
  }

  const { data, error } = await supabase
    .from('avatars')
    .update({ profiling_data })
    .eq('id', avatarId)
    .select()
    .single()

  if (error) {
    throw new ProfilingServiceError(
      `Failed to save profiling answer: ${error.message}`,
      error,
    )
  }

  return data
}

/** Read completeness from the avatar row — never compute/write from the client. */
export async function refreshAvatarProfilingState(avatarId: string): Promise<Avatar> {
  return fetchAvatar(avatarId)
}
