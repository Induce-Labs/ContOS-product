import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { completeOAuthCallback } from '../lib/auth'
import { resolvePostAuthPath } from '../lib/projects'

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function handleCallback() {
      try {
        await completeOAuthCallback()
        const nextPath = await resolvePostAuthPath()

        if (isMounted) {
          navigate(nextPath, { replace: true })
        }
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Authentication callback failed unexpectedly',
          )
        }
      }
    }

    void handleCallback()

    return () => {
      isMounted = false
    }
  }, [navigate])

  if (errorMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 text-center">
          <h1 className="text-xl font-semibold text-ink">Sign in failed</h1>
          <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
          <Link
            to="/login"
            className="mt-6 inline-block text-sm font-medium text-accent-primary hover:text-accent-primary-deep"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas text-ink-muted">
      Completing sign in…
    </div>
  )
}
