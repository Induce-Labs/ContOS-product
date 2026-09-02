import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { resolvePostAuthPath } from '../lib/projects'

export function GuestRoute() {
  const { session, isLoading } = useAuth()
  const [redirectPath, setRedirectPath] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function resolveRedirect() {
      if (!session) {
        return
      }

      try {
        const nextPath = await resolvePostAuthPath()

        if (isMounted) {
          setRedirectPath(nextPath)
        }
      } catch {
        if (isMounted) {
          setRedirectPath('/dashboard')
        }
      }
    }

    void resolveRedirect()

    return () => {
      isMounted = false
    }
  }, [session])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-ink-muted">
        Loading session…
      </div>
    )
  }

  if (session) {
    if (!redirectPath) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-canvas text-ink-muted">
          Loading session…
        </div>
      )
    }

    return <Navigate to={redirectPath} replace />
  }

  return <Outlet />
}
