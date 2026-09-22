import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import i18n from '../i18n'
import { completeOAuthCallback } from '../lib/auth'
import { hydrateAppLanguageFromProfile } from '../lib/onboarding'
import { resolvePostAuthPath } from '../lib/projects'

const CALLBACK_TIMEOUT_MS = 20_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message))
    }, ms)

    promise
      .then((value) => {
        window.clearTimeout(timer)
        resolve(value)
      })
      .catch((error: unknown) => {
        window.clearTimeout(timer)
        reject(error)
      })
  })
}

export function AuthCallbackPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const startedRef = useRef(false)
  const settledRef = useRef(false)

  useEffect(() => {
    // React Strict Mode remounts effects in dev: a local `isMounted` flag would be
    // cleared on cleanup while `startedRef` blocks a second run — leaving the UI
    // stuck on this page even though the session was stored. Settle via refs instead.
    if (startedRef.current) {
      return
    }
    startedRef.current = true

    async function handleCallback() {
      const timeoutMessage = i18n.t('auth.callback.timeout')
      const unexpectedMessage = i18n.t('auth.callback.failedUnexpected')

      try {
        // Skip language hydrate here — changing i18n mid-callback re-renders this
        // page and would cancel navigate if the effect depended on `t`.
        const nextPath = await withTimeout(
          (async () => {
            await completeOAuthCallback()
            return resolvePostAuthPath({ hydrateLanguage: false })
          })(),
          CALLBACK_TIMEOUT_MS,
          timeoutMessage,
        )

        if (!settledRef.current) {
          settledRef.current = true
          navigate(nextPath, { replace: true })
          // Apply preferred language after navigate so i18n updates cannot cancel this flow.
          void hydrateAppLanguageFromProfile()
        }
      } catch (error) {
        if (!settledRef.current) {
          settledRef.current = true
          setErrorMessage(
            error instanceof Error ? error.message : unexpectedMessage,
          )
        }
      }
    }

    void handleCallback()
  }, [navigate])

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
