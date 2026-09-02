import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { isOnboardingComplete, resolveCurrentOnboardingPath } from '../lib/onboarding'

export function RequireOnboardingComplete() {
  const [status, setStatus] = useState<'loading' | 'complete' | 'incomplete' | 'error'>(
    'loading',
  )
  const [redirectPath, setRedirectPath] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function loadOnboardingStatus() {
      try {
        const completed = await isOnboardingComplete()

        if (!isMounted) {
          return
        }

        if (completed) {
          setStatus('complete')
          return
        }

        const path = await resolveCurrentOnboardingPath()
        setRedirectPath(path)
        setStatus('incomplete')
      } catch (error) {
        if (isMounted) {
          setStatus('error')
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Failed to verify onboarding status unexpectedly',
          )
        }
      }
    }

    void loadOnboardingStatus()

    return () => {
      isMounted = false
    }
  }, [])

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-ink-muted">
        Loading workspace…
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="max-w-md rounded-[2rem] border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
          {errorMessage}
        </div>
      </div>
    )
  }

  if (status === 'incomplete' && redirectPath) {
    return <Navigate to={redirectPath} replace />
  }

  return <Outlet />
}
