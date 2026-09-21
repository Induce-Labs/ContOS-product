import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { completePostizOAuthCallback, PostizApiError } from '../lib/postiz'

const POSTIZ_CALLBACK_MESSAGE_TYPE = 'contos:postiz-callback' as const

type PostizCallbackMessage =
  | { type: typeof POSTIZ_CALLBACK_MESSAGE_TYPE; status: 'denied' }
  | { type: typeof POSTIZ_CALLBACK_MESSAGE_TYPE; status: 'error'; message: string }

function notifyParent(message: PostizCallbackMessage): void {
  if (typeof window === 'undefined' || window.opener == null) {
    return
  }
  window.opener.postMessage(message, window.location.origin)
}

function clearSensitiveQueryParams(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  url.searchParams.delete('error')
  url.searchParams.delete('error_description')
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
}

export function PostizCallbackPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) {
      return
    }
    startedRef.current = true

    let isMounted = true

    async function handleCallback() {
      const oauthError = searchParams.get('error')
      if (oauthError === 'access_denied') {
        clearSensitiveQueryParams()
        notifyParent({ type: POSTIZ_CALLBACK_MESSAGE_TYPE, status: 'denied' })
        if (isMounted) {
          setErrorMessage(t('postiz.callback.denied'))
        }
        return
      }

      if (oauthError) {
        const description = searchParams.get('error_description')
        clearSensitiveQueryParams()
        const message = description
          ? t('postiz.callback.oauthErrorWithDetail', { detail: description })
          : t('postiz.callback.oauthError')
        notifyParent({
          type: POSTIZ_CALLBACK_MESSAGE_TYPE,
          status: 'error',
          message,
        })
        if (isMounted) {
          setErrorMessage(message)
        }
        return
      }

      const code = searchParams.get('code')
      const state = searchParams.get('state')
      clearSensitiveQueryParams()

      if (!code || !state) {
        const message = t('postiz.callback.missingParams')
        notifyParent({
          type: POSTIZ_CALLBACK_MESSAGE_TYPE,
          status: 'error',
          message,
        })
        if (isMounted) {
          setErrorMessage(message)
        }
        return
      }

      try {
        const result = await completePostizOAuthCallback(code, state)
        window.location.replace(result.authorization_url)
      } catch (error) {
        const message =
          error instanceof PostizApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : t('postiz.callback.failedUnexpected')
        notifyParent({
          type: POSTIZ_CALLBACK_MESSAGE_TYPE,
          status: 'error',
          message,
        })
        if (isMounted) {
          setErrorMessage(message)
        }
      }
    }

    void handleCallback()

    return () => {
      isMounted = false
    }
  }, [searchParams, t])

  if (errorMessage) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="w-full max-w-md rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 text-center">
          <h1 className="text-xl font-semibold text-ink">{t('postiz.callback.failedTitle')}</h1>
          <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
          <Link
            to="/dashboard"
            className="mt-6 inline-block text-sm font-medium text-accent-primary-deep hover:opacity-80"
          >
            {t('postiz.callback.backToCalendar')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas text-ink-muted">
      {t('postiz.callback.completing')}
    </div>
  )
}
