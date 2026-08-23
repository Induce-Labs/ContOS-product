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

  constructor(message: string, cause?: unknown, code?: string) {
    super(message)
    this.name = 'AvatarsServiceError'
    this.code = code
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
    )
  }
  return new AvatarsServiceError(message, error)
}

export function avatarTypeLabel(type: ProjectType | string): string {
  return type === 'business' ? 'Business' : 'Personal Brand'
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
      throw mapAvatarError({ message: error.message })
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
