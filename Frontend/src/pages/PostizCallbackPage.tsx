import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

/**
 * Legacy ContOS Postiz org-consent callback.
 * Approach B provisions org tokens server-side; connect LinkedIn from Calendar.
 */
export function PostizCallbackPage() {
  const { t } = useTranslation()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) {
      return
    }
    startedRef.current = true
    setErrorMessage(t('postiz.callback.deprecated'))
  }, [t])

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-[2rem] border border-border-hairline bg-canvas-raised p-8 text-center">
        <h1 className="text-xl font-semibold text-ink">{t('postiz.callback.failedTitle')}</h1>
        <p className="mt-3 text-sm text-red-600">
          {errorMessage ?? t('postiz.callback.deprecated')}
        </p>
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
