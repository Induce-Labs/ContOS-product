import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { completeOAuthCallback } from '../lib/auth'
import { resolvePostAuthPath } from '../lib/projects'

export function AuthCallbackPage() {
  const { t } = useTranslation()
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
              : t('auth.callback.failedUnexpected'),
          )
        }
      }
    }

    void handleCallback()

    return () => {
      isMounted = false
    }
  }, [navigate, t])

  if (errorMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 text-center">
          <h1 className="text-xl font-semibold text-ink">{t('auth.callback.failedTitle')}</h1>
          <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
          <Link
            to="/login"
            className="mt-6 inline-block text-sm font-medium text-accent-primary-deep hover:opacity-80"
          >
            {t('auth.callback.backToSignIn')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas text-ink-muted">
      {t('auth.callback.completing')}
    </div>
  )
}
