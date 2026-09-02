import { useCallback, useEffect, useState } from 'react'
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
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const applyProjects = useCallback(
    (userProjects: Project[]) => {
      setProjects(userProjects)

      if (userProjects.length === 0) {
        setActiveProject(null)
        return
      }

      const selectedProject = projectId
        ? (userProjects.find((project) => project.id === projectId) ?? null)
        : resolveActiveProject(userProjects)

      if (projectId && !selectedProject) {
        setProjectsError('Project not found or you do not have access to it.')
        setActiveProject(resolveActiveProject(userProjects))
        return
      }

      if (selectedProject) {
        setActiveProject(selectedProject)
        setLastUsedProjectId(selectedProject.id)

        if (!projectId) {
          navigate(`/dashboard/${selectedProject.id}`, { replace: true })
        }
      }
    },
    [navigate, projectId],
  )

  const refreshProjects = useCallback(async () => {
    try {
      const userProjects = await fetchUserProjects()
      applyProjects(userProjects)
      setProjectsError(null)
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : 'Failed to load dashboard')
    }
  }, [applyProjects])

  useEffect(() => {
    let isMounted = true

    async function loadProjects() {
      setProjectsLoading(true)
      setProjectsError(null)

      try {
        const userProjects = await fetchUserProjects()

        if (!isMounted) {
          return
        }

        applyProjects(userProjects)
      } catch (error) {
        if (isMounted) {
          setProjectsError(error instanceof Error ? error.message : 'Failed to load dashboard')
        }
      } finally {
        if (isMounted) {
          setProjectsLoading(false)
        }
      }
    }

    void loadProjects()

    return () => {
      isMounted = false
    }
  }, [applyProjects])

  async function handleSignOut() {
    setIsSigningOut(true)

    try {
      await signOut()
      navigate('/login', { replace: true })
    } catch (error) {
      setProjectsError(error instanceof Error ? error.message : 'Sign out failed')
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
    refreshProjects,
  }
}
