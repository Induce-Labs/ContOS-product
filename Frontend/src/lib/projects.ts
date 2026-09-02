import { supabase } from './supabase'
import { isOnboardingComplete, resolveCurrentOnboardingPath } from './onboarding'
import type { Tables, TablesInsert } from '../types/database'
import type { ProjectType } from '../types/contos'

/** @deprecated Use Avatar from avatars.ts — avatars table replaces projects */
export type Project = Tables<'avatars'>

const LAST_AVATAR_STORAGE_KEY = 'contos_last_avatar_id'
const LEGACY_LAST_PROJECT_STORAGE_KEY = 'contos_last_project_id'

export class ProjectsServiceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ProjectsServiceError'
    if (cause instanceof Error) {
      this.cause = cause
    }
  }
}

export async function fetchUserProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('avatars')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) {
    throw new ProjectsServiceError(
      `Failed to load avatars: ${error.message}`,
      error,
    )
  }

  return data
}

export async function createProject(
  name: string,
  type: ProjectType,
): Promise<Project> {
  const trimmedName = name.trim()

  if (!trimmedName) {
    throw new ProjectsServiceError('Avatar name is required.')
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw new ProjectsServiceError(
      `Failed to read authenticated user: ${userError.message}`,
      userError,
    )
  }

  if (!user) {
    throw new ProjectsServiceError('You must be signed in to create an avatar.')
  }

  const row: TablesInsert<'avatars'> = {
    name: trimmedName,
    type,
    user_id: user.id,
    status: 'onboarding',
  }

  const { data, error } = await supabase.from('avatars').insert(row).select().single()

  if (error) {
    if (error.message.includes('AVATAR_LIMIT_REACHED')) {
      throw new ProjectsServiceError(
        "You've reached the maximum number of avatars on your current plan.",
        error,
      )
    }
    throw new ProjectsServiceError(`Failed to create avatar: ${error.message}`, error)
  }

  return data
}

export async function updateProjectStatus(
  avatarId: string,
  status: Project['status'],
): Promise<Project> {
  const { data, error } = await supabase
    .from('avatars')
    .update({ status })
    .eq('id', avatarId)
    .select()
    .single()

  if (error) {
    throw new ProjectsServiceError(
      `Failed to update avatar status: ${error.message}`,
      error,
    )
  }

  return data
}

export function getLastUsedProjectId(): string | null {
  return (
    localStorage.getItem(LAST_AVATAR_STORAGE_KEY) ??
    localStorage.getItem(LEGACY_LAST_PROJECT_STORAGE_KEY)
  )
}

export function setLastUsedProjectId(avatarId: string): void {
  localStorage.setItem(LAST_AVATAR_STORAGE_KEY, avatarId)
  localStorage.removeItem(LEGACY_LAST_PROJECT_STORAGE_KEY)
}

export function resolveActiveProject(projects: Project[]): Project | null {
  if (projects.length === 0) {
    return null
  }

  const lastUsedId = getLastUsedProjectId()

  if (lastUsedId) {
    const lastUsed = projects.find((project) => project.id === lastUsedId)
    if (lastUsed) {
      return lastUsed
    }
  }

  return projects.find((project) => project.is_default) ?? projects[0]
}

export async function resolveDashboardPath(): Promise<string> {
  const projects = await fetchUserProjects()

  if (projects.length === 0) {
    return '/dashboard'
  }

  const activeProject = resolveActiveProject(projects)

  if (!activeProject) {
    return '/dashboard'
  }

  setLastUsedProjectId(activeProject.id)
  return `/dashboard/${activeProject.id}`
}

export async function resolvePostAuthPath(): Promise<string> {
  const completed = await isOnboardingComplete()

  if (!completed) {
    return resolveCurrentOnboardingPath()
  }

  return resolveDashboardPath()
}
