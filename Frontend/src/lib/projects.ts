import { supabase } from './supabase'
import type { Tables, TablesInsert } from '../types/database'
import type { ProjectType } from '../types/contos'

export type Project = Tables<'projects'>

const LAST_PROJECT_STORAGE_KEY = 'contos_last_project_id'

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
    .from('projects')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) {
    throw new ProjectsServiceError(
      `Failed to load projects: ${error.message}`,
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
    throw new ProjectsServiceError('Project name is required.')
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
    throw new ProjectsServiceError('You must be signed in to create a project.')
  }

  const row: TablesInsert<'projects'> = {
    name: trimmedName,
    type,
    user_id: user.id,
    status: 'onboarding',
  }

  const { data, error } = await supabase.from('projects').insert(row).select().single()

  if (error) {
    throw new ProjectsServiceError(`Failed to create project: ${error.message}`, error)
  }

  return data
}

export async function updateProjectStatus(
  projectId: string,
  status: Project['status'],
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .update({ status })
    .eq('id', projectId)
    .select()
    .single()

  if (error) {
    throw new ProjectsServiceError(
      `Failed to update project status: ${error.message}`,
      error,
    )
  }

  return data
}

export function getLastUsedProjectId(): string | null {
  return localStorage.getItem(LAST_PROJECT_STORAGE_KEY)
}

export function setLastUsedProjectId(projectId: string): void {
  localStorage.setItem(LAST_PROJECT_STORAGE_KEY, projectId)
}

export function resolveActiveProject(projects: Project[]): Project | null {
  if (projects.length === 0) {
    return null
  }

  const lastUsedProjectId = getLastUsedProjectId()

  if (lastUsedProjectId) {
    const lastUsedProject = projects.find((project) => project.id === lastUsedProjectId)
    if (lastUsedProject) {
      return lastUsedProject
    }
  }

  return projects[0]
}

export async function resolvePostAuthPath(): Promise<string> {
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
