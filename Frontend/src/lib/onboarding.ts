import { supabase } from './supabase'
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
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'OnboardingServiceError'
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
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error) {
    throw new OnboardingServiceError(
      `Failed to read authenticated user: ${error.message}`,
      error,
    )
  }

  if (!user) {
    throw new OnboardingServiceError('You must be signed in to access onboarding.')
  }

  return user.id
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

export async function ensureUserProfile(): Promise<UserProfile> {
  const existingProfile = await fetchUserProfile()

  if (existingProfile) {
    return existingProfile
  }

  const userId = await getAuthenticatedUserId()

  const { data, error } = await supabase
    .from('user_profiles')
    .insert({ user_id: userId })
    .select()
    .single()

  if (error) {
    throw new OnboardingServiceError(
      `Failed to create user profile: ${error.message}`,
      error,
    )
  }

  return data
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
