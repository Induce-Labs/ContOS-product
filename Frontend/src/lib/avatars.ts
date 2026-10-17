import i18n, { SUPPORTED_LANGUAGES } from '../i18n'
import { remoteStatusCode } from './devLog'
import { supabase } from './supabase'
import type { Tables } from '../types/database'
import type { ProjectType } from '../types/contos'
import {
  ProjectsServiceError,
  createProject,
  fetchUserProjects,
  type Project,
} from './projects'

export type Avatar = Project

export const MAX_AVATARS = 3

export class AvatarsServiceError extends Error {
  readonly code?: string
  readonly statusCode: number | null

  constructor(
    message: string,
    cause?: unknown,
    code?: string,
    statusCode?: number | null,
  ) {
    super(message)
    this.name = 'AvatarsServiceError'
    this.code = code
    this.statusCode = remoteStatusCode(cause, statusCode)
    if (cause instanceof Error) {
      this.cause = cause
    }
  }
}

function mapAvatarError(error: { message: string; code?: string }): AvatarsServiceError {
  const message = error.message || 'Avatar operation failed'
  if (message.includes('AVATAR_LIMIT_REACHED')) {
    return new AvatarsServiceError(
      "You've reached the maximum number of avatars on your current plan.",
      error,
      'AVATAR_LIMIT_REACHED',
      null,
    )
  }
  return new AvatarsServiceError(message, error)
}

function workspaceTypeKey(type: ProjectType | string): string {
  switch (type) {
    case 'personal_branding':
      return 'personalBrand'
    case 'business_1':
      return 'business1'
    case 'business_2':
      return 'business2'
    case 'business':
      return 'business'
    default:
      return 'workspace'
  }
}

function optionTitleKey(type: ProjectType | string): string | null {
  switch (type) {
    case 'personal_branding':
      return 'onboarding.projectType.options.personalBrand.title'
    case 'business_1':
      return 'onboarding.projectType.options.business1.title'
    case 'business_2':
      return 'onboarding.projectType.options.business2.title'
    default:
      return null
  }
}

export function avatarTypeLabel(type: ProjectType | string): string {
  return i18n.t(`workspaceTypes.${workspaceTypeKey(type)}`)
}

/** Known default labels for a type across all supported UI languages. */
function defaultAvatarNameAliases(type: ProjectType | string): Set<string> {
  const aliases = new Set<string>()
  const workspaceKey = `workspaceTypes.${workspaceTypeKey(type)}`
  const optionKey = optionTitleKey(type)

  for (const lng of SUPPORTED_LANGUAGES) {
    const tLng = i18n.getFixedT(lng, 'common')
    const workspaceLabel = tLng(workspaceKey)
    if (typeof workspaceLabel === 'string' && workspaceLabel.trim()) {
      aliases.add(workspaceLabel.trim())
    }
    if (optionKey) {
      const optionLabel = tLng(optionKey)
      if (typeof optionLabel === 'string' && optionLabel.trim()) {
        aliases.add(optionLabel.trim())
      }
    }
  }

  return aliases
}

/**
 * Show default type-named avatars in the active UI language.
 * Custom renames (names outside known defaults) stay as stored.
 */
export function displayAvatarName(avatar: {
  name: string
  type: ProjectType | string
}): string {
  const trimmed = avatar.name.trim()
  if (!trimmed) {
    return avatarTypeLabel(avatar.type)
  }
  if (defaultAvatarNameAliases(avatar.type).has(trimmed)) {
    return avatarTypeLabel(avatar.type)
  }
  return avatar.name
}

/** Always store the English workspace type label so DB names stay stable. */
export function defaultAvatarNameForType(type: ProjectType): string {
  return i18n.getFixedT('en', 'common')(`workspaceTypes.${workspaceTypeKey(type)}`)
}

export async function fetchUserAvatars(): Promise<Avatar[]> {
  return fetchUserProjects()
}

export async function fetchAvatar(avatarId: string): Promise<Avatar> {
  const { data, error } = await supabase
    .from('avatars')
    .select('*')
    .eq('id', avatarId)
    .single()

  if (error) {
    throw mapAvatarError(error)
  }

  return data
}

export async function createAvatar(name: string, type: ProjectType): Promise<Avatar> {
  try {
    return await createProject(name, type)
  } catch (error) {
    if (error instanceof ProjectsServiceError) {
      throw new AvatarsServiceError(
        error.message,
        error,
        undefined,
        error.statusCode,
      )
    }
    throw error
  }
}

export async function renameAvatar(avatarId: string, name: string): Promise<Avatar> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new AvatarsServiceError('Avatar name is required.')
  }

  const { data, error } = await supabase
    .from('avatars')
    .update({ name: trimmed })
    .eq('id', avatarId)
    .select()
    .single()

  if (error) {
    throw mapAvatarError(error)
  }

  return data
}

export async function deleteAvatar(avatarId: string): Promise<void> {
  const { error } = await supabase.from('avatars').delete().eq('id', avatarId)

  if (error) {
    throw mapAvatarError(error)
  }
}

export async function setDefaultAvatar(avatarId: string): Promise<Avatar> {
  const { data, error } = await supabase.rpc('set_default_avatar', {
    p_avatar_id: avatarId,
  })

  if (error) {
    throw mapAvatarError(error)
  }

  return data as Tables<'avatars'>
}

export function resolveDefaultAvatar(avatars: Avatar[]): Avatar | null {
  if (avatars.length === 0) {
    return null
  }
  return avatars.find((avatar) => avatar.is_default) ?? avatars[0]
}
