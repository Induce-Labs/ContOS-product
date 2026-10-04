import { logDevError, remoteStatusCode } from './devLog'
import { supabase } from './supabase'
import {
  clearInvalidSessionAndRedirectToSignUp,
  isInvalidOrDeletedUserError,
  requireAuthenticatedUserId,
} from './auth'
import type { Tables } from '../types/database'
import type { ProjectType } from '../types/contos'
import {
  changeAppLanguage,
  isSupportedLanguage,
  type SupportedLanguage,
} from '../i18n'

export type UserProfile = Tables<'user_profiles'>

export type OnboardingStep =
  | 'welcome'
  | 'project_type'
  | 'profiling'
  | 'competitors'
  | 'completed'

export type AdvanceOnboardingExtras = {
  avatarId?: string
  projectType?: ProjectType
}

export class OnboardingServiceError extends Error {
  readonly statusCode: number | null

  constructor(message: string, cause?: unknown, statusCode?: number | null) {
    super(message)
    this.name = 'OnboardingServiceError'
    this.statusCode = remoteStatusCode(cause, statusCode)
    if (cause instanceof Error) {
      this.cause = cause
    }
  }
}

export const ONBOARDING_LANGUAGE_PATH = '/onboarding/language'

const ONBOARDING_STEP_PATHS: Record<OnboardingStep, string> = {
  welcome: '/welcome',
  project_type: '/onboarding/project',
  profiling: '/onboarding/profiling',
  competitors: '/onboarding/competitors',
  completed: '/dashboard',
}

async function getAuthenticatedUserId(): Promise<string> {
  try {
    return await requireAuthenticatedUserId()
  } catch (error) {
    throw new OnboardingServiceError(
      error instanceof Error
        ? error.message
        : 'You must be signed in to access onboarding.',
      error,
    )
  }
}

function parseOnboardingStep(value: string | null | undefined): OnboardingStep {
  if (
    value === 'welcome' ||
    value === 'project_type' ||
    value === 'profiling' ||
    value === 'competitors' ||
    value === 'completed'
  ) {
    return value
  }

  return 'welcome'
}

export function parsePreferredLanguage(
  value: string | null | undefined,
): SupportedLanguage | null {
  return isSupportedLanguage(value) ? value : null
}

export async function fetchUserProfile(): Promise<UserProfile | null> {
  const userId = await getAuthenticatedUserId()

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    throw new OnboardingServiceError(
      `Failed to load user profile: ${error.message}`,
      error,
    )
  }

  return data
}

function isUniqueConflict(error: { code?: string; message?: string }): boolean {
  const code = error.code ?? ''
  const message = (error.message ?? '').toLowerCase()
  return (
    code === '23505' ||
    code === 'PGRST116' ||
    message.includes('duplicate') ||
    message.includes('conflict') ||
    message.includes('unique')
  )
}

/** Coalesce parallel ensure calls (e.g. React Strict Mode) for the same user. */
const ensureProfileInFlight = new Map<string, Promise<UserProfile>>()

async function createOrLoadUserProfile(userId: string): Promise<UserProfile> {
  const existingProfile = await fetchUserProfile()
  if (existingProfile) {
    return existingProfile
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .insert({ user_id: userId })
    .select()
    .single()

  if (!error && data) {
    return data
  }

  // Row already exists (auth trigger or concurrent ensure) — load it.
  if (error && isUniqueConflict(error)) {
    const raced = await fetchUserProfile()
    if (raced) {
      return raced
    }
  }

  // Auth user was deleted in Supabase while a local JWT remained.
  if (error && isInvalidOrDeletedUserError(error)) {
    logDevError('create user profile', {
      error: error.message ?? 'unknown error',
    })
    return await clearInvalidSessionAndRedirectToSignUp(
      'Your account is no longer available. Please sign up again.',
    )
  }

  throw new OnboardingServiceError(
    `Failed to create user profile: ${error?.message ?? 'unknown error'}`,
    error,
  )
}

export async function ensureUserProfile(): Promise<UserProfile> {
  const userId = await getAuthenticatedUserId()
  const pending = ensureProfileInFlight.get(userId)
  if (pending) {
    return pending
  }

  const task = createOrLoadUserProfile(userId).finally(() => {
    ensureProfileInFlight.delete(userId)
  })
  ensureProfileInFlight.set(userId, task)
  return task
}

export async function hydrateAppLanguageFromProfile(
  profile?: UserProfile | null,
): Promise<SupportedLanguage | null> {
  const resolved = profile ?? (await ensureUserProfile())
  const preferred = parsePreferredLanguage(resolved.preferred_language)
  if (!preferred) {
    return null
  }
  await changeAppLanguage(preferred)
  return preferred
}

export async function savePreferredLanguage(
  language: SupportedLanguage,
): Promise<UserProfile> {
  if (!isSupportedLanguage(language)) {
    throw new OnboardingServiceError(
      `Unsupported preferred language "${language}". Expected one of: en, hi, zh, fr, es.`,
    )
  }

  const userId = await getAuthenticatedUserId()
  await ensureUserProfile()

  const { data, error } = await supabase
    .from('user_profiles')
    .update({ preferred_language: language })
    .eq('user_id', userId)
    .select()
    .single()

  if (error) {
    throw new OnboardingServiceError(
      `Failed to save preferred language: ${error.message}`,
      error,
    )
  }

  await changeAppLanguage(language)
  return data
}

export async function getOnboardingStep(): Promise<OnboardingStep> {
  const profile = await ensureUserProfile()

  if (profile.onboarding_completed_at !== null) {
    return 'completed'
  }

  return parseOnboardingStep(profile.onboarding_step)
}

export function resolveOnboardingPath(step: OnboardingStep): string {
  return ONBOARDING_STEP_PATHS[step]
}

export async function resolveCurrentOnboardingPath(): Promise<string> {
  const profile = await ensureUserProfile()

  if (profile.onboarding_completed_at !== null) {
    return resolveOnboardingPath('completed')
  }

  if (!parsePreferredLanguage(profile.preferred_language)) {
    return ONBOARDING_LANGUAGE_PATH
  }

  return resolveOnboardingPath(parseOnboardingStep(profile.onboarding_step))
}

export async function isOnboardingComplete(): Promise<boolean> {
  const profile = await ensureUserProfile()
  return profile.onboarding_completed_at !== null
}

export async function needsLanguageSelection(): Promise<boolean> {
  const profile = await ensureUserProfile()
  if (profile.onboarding_completed_at !== null) {
    return false
  }
  return !parsePreferredLanguage(profile.preferred_language)
}

export async function advanceOnboardingStep(
  step: OnboardingStep,
  extras?: AdvanceOnboardingExtras,
): Promise<UserProfile> {
  const userId = await getAuthenticatedUserId()

  const update: {
    onboarding_step: OnboardingStep
    onboarding_avatar_id?: string
    onboarding_project_type?: ProjectType
  } = {
    onboarding_step: step,
  }

  if (extras?.avatarId !== undefined) {
    update.onboarding_avatar_id = extras.avatarId
  }

  if (extras?.projectType !== undefined) {
    update.onboarding_project_type = extras.projectType
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .update(update)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) {
    throw new OnboardingServiceError(
      `Failed to advance onboarding to step "${step}": ${error.message}`,
      error,
    )
  }

  return data
}

export async function completeOnboarding(): Promise<UserProfile> {
  const userId = await getAuthenticatedUserId()
  const completedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from('user_profiles')
    .update({
      onboarding_completed_at: completedAt,
      onboarding_step: 'completed',
    })
    .eq('user_id', userId)
    .select()
    .single()

  if (error) {
    throw new OnboardingServiceError(
      `Failed to complete onboarding: ${error.message}`,
      error,
    )
  }

  return data
}

export async function getOnboardingAvatarId(): Promise<string | null> {
  const profile = await ensureUserProfile()
  return profile.onboarding_avatar_id
}
