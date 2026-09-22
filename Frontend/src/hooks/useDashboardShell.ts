import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from './useAuth'
import {
  fetchUserProjects,
  resolveActiveProject,
  setLastUsedProjectId,
  type Project,
} from '../lib/projects'

export function useDashboardShell() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsFetchError, setProjectsFetchError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Derive from URL + loaded list so Calendar/Postiz never keep a stale Avatar A
  // while the route already points at Avatar B.
  const activeProject = useMemo(() => {
    if (projects.length === 0) {
      return null
    }
    if (projectId) {
      return projects.find((project) => project.id === projectId) ?? null
    }
    return resolveActiveProject(projects)
  }, [projectId, projects])

  const projectsError = useMemo(() => {
    if (projectsFetchError) {
      return projectsFetchError
    }
    if (
      projectId &&
      !projectsLoading &&
      projects.length > 0 &&
      !projects.some((project) => project.id === projectId)
    ) {
      return 'Project not found or you do not have access to it.'
    }
    return null
  }, [projectId, projects, projectsFetchError, projectsLoading])

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true)
    setProjectsFetchError(null)
    try {
      const userProjects = await fetchUserProjects()
      setProjects(userProjects)
    } catch (error) {
      setProjectsFetchError(
        error instanceof Error ? error.message : 'Failed to load dashboard',
      )
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  useEffect(() => {
    // Initial + identity-stable reload of the avatar list (external store → React state).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetchUserProjects populates projects state
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (projectsLoading || projectId || projects.length === 0) {
      return
    }
    const selected = resolveActiveProject(projects)
    if (selected) {
      navigate(`/dashboard/${selected.id}`, { replace: true })
    }
  }, [navigate, projectId, projects, projectsLoading])

  useEffect(() => {
    if (activeProject) {
      setLastUsedProjectId(activeProject.id)
    }
  }, [activeProject])

  async function handleSignOut() {
    setIsSigningOut(true)

    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (error) {
      setProjectsFetchError(error instanceof Error ? error.message : 'Sign out failed')
      setIsSigningOut(false)
    }
  }

  return {
    projectId,
    user,
    projects,
    setProjects,
    activeProject,
    projectsLoading,
    projectsError,
    isSigningOut,
    sidebarOpen,
    setSidebarOpen,
    handleSignOut,
    refreshProjects: loadProjects,
  }
}
