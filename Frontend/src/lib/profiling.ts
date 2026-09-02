import type { Json } from '../types/database'
import type { ProjectType } from '../types/contos'
import {
  findMatchingSelectOption,
  isOtherSelectOption,
  parseCompetitorNames,
  serializeCompetitorNames,
  type ProfilingQuestionDef,
  type QuestionInput,
} from '../config/onboardingProfilingQuestions'
import { fetchAvatar, type Avatar } from './avatars'
import { supabase } from './supabase'

/** One question object inside `profiling_questionnaires.questions` JSONB. */
export type ProfilingQuestionJson = {
  key: string
  question: string
  display_order: number
  is_active: boolean
  required: boolean
  input_kind: string
  options: Json | null
  allow_other: boolean
  placeholder: string | null
  section_label: string | null
  competitor_max: number | null
}

export type ProfilingQuestionnaireTemplate = 'personal_branding' | 'business'

/** Maps avatar/project type to questionnaire row (DB: resolve_profiling_template). */
export function resolveProfilingTemplate(type: ProjectType): ProfilingQuestionnaireTemplate {
  if (type === 'personal_branding') {
    return 'personal_branding'
  }
  return 'business'
}

export type { ProfilingQuestionDef, QuestionInput }

export class ProfilingServiceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ProfilingServiceError'
    if (cause instanceof Error) {
      this.cause = cause
    }
  }
}

function parseOptions(value: Json | null | undefined): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function parseProfilingQuestionJson(value: unknown, index: number): ProfilingQuestionJson {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProfilingServiceError(
      `Invalid profiling question at index ${index}: expected object.`,
    )
  }

  const row = value as Record<string, unknown>
  const key = row.key
  const question = row.question
  const inputKind = row.input_kind

  if (typeof key !== 'string' || !key.trim()) {
    throw new ProfilingServiceError(`Invalid profiling question at index ${index}: missing key.`)
  }
  if (typeof question !== 'string' || !question.trim()) {
    throw new ProfilingServiceError(
      `Invalid profiling question "${key}": missing question text.`,
    )
  }
  if (typeof inputKind !== 'string' || !inputKind.trim()) {
    throw new ProfilingServiceError(
      `Invalid profiling question "${key}": missing input_kind.`,
    )
  }

  return {
    key: key.trim(),
    question: question.trim(),
    display_order: typeof row.display_order === 'number' ? row.display_order : index + 1,
    is_active: row.is_active !== false,
    required: row.required !== false,
    input_kind: inputKind,
    options: (row.options as Json | null | undefined) ?? null,
    allow_other: row.allow_other === true,
    placeholder: typeof row.placeholder === 'string' ? row.placeholder : null,
    section_label: typeof row.section_label === 'string' ? row.section_label : null,
    competitor_max: typeof row.competitor_max === 'number' ? row.competitor_max : null,
  }
}

export function mapProfilingQuestionRow(row: ProfilingQuestionJson): ProfilingQuestionDef {
  const kind = row.input_kind
  let input: QuestionInput

  if (kind === 'single_select') {
    input = {
      kind: 'single_select',
      options: parseOptions(row.options),
      allowOther: row.allow_other,
    }
  } else if (kind === 'competitor_names') {
    input = {
      kind: 'competitor_names',
      max: row.competitor_max && row.competitor_max > 0 ? row.competitor_max : 3,
    }
  } else if (kind === 'textarea' || kind === 'url' || kind === 'text') {
    input = { kind }
  } else {
    throw new ProfilingServiceError(
      `Unsupported profiling question input_kind "${String(kind)}" for key "${row.key}".`,
    )
  }

  return {
    key: row.key,
    question: row.question,
    required: row.required,
    sectionLabel: row.section_label?.trim() || 'FOUNDATIONS',
    placeholder: row.placeholder ?? undefined,
    input,
  }
}

export async function fetchProfilingQuestions(
  type: ProjectType,
): Promise<ProfilingQuestionJson[]> {
  const templateId = resolveProfilingTemplate(type)
  const { data, error } = await supabase
    .from('profiling_questionnaires')
    .select('questions')
    .eq('id', templateId)
    .single()

  if (error) {
    throw new ProfilingServiceError(
      `Failed to load profiling questionnaire "${templateId}": ${error.message}`,
      error,
    )
  }

  if (!Array.isArray(data?.questions)) {
    throw new ProfilingServiceError(
      `Profiling questionnaire "${templateId}" has invalid questions payload (expected JSON array).`,
    )
  }

  return data.questions
    .map((entry, index) => parseProfilingQuestionJson(entry, index))
    .filter((question) => question.is_active)
    .sort((a, b) => a.display_order - b.display_order)
}

export async function fetchProfilingQuestionnaire(
  type: ProjectType,
): Promise<ProfilingQuestionDef[]> {
  const rows = await fetchProfilingQuestions(type)
  if (rows.length === 0) {
    throw new ProfilingServiceError(
      `No active profiling questions found for project type "${type}".`,
    )
  }
  return rows.map(mapProfilingQuestionRow)
}

export function extractProfilingAnswerText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const answer = (value as Record<string, unknown>).answer
    if (typeof answer === 'string') {
      return answer
    }
  }
  return ''
}

export function profilingDataToAnswers(
  profilingData: Json | null | undefined,
  questions: Array<Pick<ProfilingQuestionDef, 'key'> | Pick<ProfilingQuestionJson, 'key'>>,
): Record<string, string> {
  const data =
    profilingData && typeof profilingData === 'object' && !Array.isArray(profilingData)
      ? (profilingData as Record<string, unknown>)
      : {}

  const answers: Record<string, string> = {}
  for (const question of questions) {
    answers[question.key] = extractProfilingAnswerText(data[question.key])
  }
  return answers
}

export function firstUnansweredQuestionIndex(
  questions: ProfilingQuestionDef[],
  answers: Record<string, string>,
): number {
  // Fresh questionnaire: start at Q1 (website), even though it is optional.
  // Without this, resume skips every optional leading question and lands on
  // the first required item (e.g. content_goal / "2 of 27").
  const hasAnyAnswer = questions.some((question) => (answers[question.key] ?? '').trim().length > 0)
  if (!hasAnyAnswer) {
    return 0
  }

  const index = questions.findIndex((question) => {
    if (!question.required) {
      return false
    }
    return !isAnswerComplete(question, answers[question.key] ?? '')
  })
  return index === -1 ? Math.max(questions.length - 1, 0) : index
}

export function isAnswerComplete(question: ProfilingQuestionDef, raw: string): boolean {
  const value = raw.trim()

  if (question.input.kind === 'competitor_names') {
    return parseCompetitorNames(value).some((name) => name.trim().length > 0)
  }

  if (question.input.kind === 'single_select') {
    if (!value) {
      return false
    }
    const matched = findMatchingSelectOption(question.input.options, value)
    if (!matched.option) {
      return false
    }
    if (isOtherSelectOption(matched.option)) {
      return value.length > 0 && !isOtherSelectOption(value)
    }
    return true
  }

  if (question.input.kind === 'url') {
    if (!value) {
      return !question.required
    }
    return isValidOptionalUrl(value)
  }

  return value.length > 0
}

export function isValidOptionalUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) {
    return true
  }
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const parsed = new URL(withProtocol)
    return Boolean(parsed.hostname.includes('.'))
  } catch {
    return false
  }
}

export function normalizeAnswerForSave(
  question: ProfilingQuestionDef,
  raw: string,
): string {
  const trimmed = raw.trim()

  if (question.input.kind === 'competitor_names') {
    return serializeCompetitorNames(parseCompetitorNames(raw))
  }

  if (question.input.kind === 'url' && trimmed) {
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  }

  if (question.input.kind === 'single_select') {
    const matched = findMatchingSelectOption(question.input.options, trimmed)
    if (matched.option && isOtherSelectOption(matched.option)) {
      return matched.otherText.trim() || trimmed
    }
    return matched.option ?? trimmed
  }

  return trimmed
}

export function validateProfilingAnswer(
  question: ProfilingQuestionDef,
  raw: string,
): string | null {
  const trimmed = raw.trim()

  if (!question.required && !trimmed) {
    return null
  }

  if (question.input.kind === 'url') {
    if (!trimmed) {
      return null
    }
    if (!isValidOptionalUrl(trimmed)) {
      return 'Enter a valid website URL (e.g. https://example.com).'
    }
    return null
  }

  if (question.input.kind === 'competitor_names') {
    if (!parseCompetitorNames(raw).some((name) => name.trim())) {
      return 'Add at least one competitor name.'
    }
    return null
  }

  if (question.input.kind === 'single_select') {
    if (!trimmed) {
      return 'Select an option to continue.'
    }
    const matched = findMatchingSelectOption(question.input.options, trimmed)
    if (!matched.option) {
      return 'Select an option to continue.'
    }
    if (isOtherSelectOption(matched.option) && isOtherSelectOption(trimmed)) {
      return 'Please describe your answer in your own words.'
    }
    if (isOtherSelectOption(matched.option) && !matched.otherText.trim() && !trimmed) {
      return 'Please describe your answer in your own words.'
    }
    return null
  }

  if (!trimmed) {
    return 'Please answer this question before continuing.'
  }

  return null
}

export async function upsertProfilingAnswer(
  avatarId: string,
  questionKey: string,
  answerText: string,
  options?: { optional?: boolean; questionText?: string },
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
    if (!options?.optional) {
      throw new ProfilingServiceError('Answer cannot be empty.')
    }

    const { [questionKey]: _removed, ...rest } = existing
    const profiling_data: Json = rest

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

  const questionText = options?.questionText?.trim()
  const entry: Json = questionText
    ? {
        question_key: questionKey,
        question: questionText,
        answer: trimmed,
      }
    : trimmed

  const profiling_data: Json = {
    ...existing,
    [questionKey]: entry,
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

/** True when the server reports all required profiling questions are answered (0–100). */
export function isRequiredProfilingComplete(completeness: number): boolean {
  return completeness >= 100
}

/** Read completeness from the avatar row — never compute/write from the client. */
export async function refreshAvatarProfilingState(avatarId: string): Promise<Avatar> {
  return fetchAvatar(avatarId)
}
