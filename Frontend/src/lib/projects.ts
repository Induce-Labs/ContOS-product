import { supabase } from './supabase'
import type { Tables } from '../types/database'

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
