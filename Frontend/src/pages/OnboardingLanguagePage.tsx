import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  LANGUAGE_NATIVE_NAMES,
  SUPPORTED_LANGUAGES,
  changeAppLanguage,
  readStoredLocale,
  type SupportedLanguage,
} from '../i18n'
import {
  ensureUserProfile,
  isOnboardingComplete,
  parsePreferredLanguage,
  resolveCurrentOnboardingPath,
  savePreferredLanguage,
} from '../lib/onboarding'
import { logDevError, userFacingMessage } from '../lib/devLog'
import { resolveDashboardPath } from '../lib/projects'

export function OnboardingLanguagePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selected, setSelected] = useState<SupportedLanguage>(() => readStoredLocale())

  useEffect(() => {
    let isMounted = true

    async function verifyAccess() {
      try {
        const completed = await isOnboardingComplete()
        if (!isMounted) {
          return
        }

        if (completed) {
          const nextPath = await resolveDashboardPath()
          navigate(nextPath, { replace: true })
          return
        }

        const profile = await ensureUserProfile()
        if (!isMounted) {
          return
        }

        const preferred = parsePreferredLanguage(profile.preferred_language)
        if (preferred) {
          await changeAppLanguage(preferred)
          const nextPath = await resolveCurrentOnboardingPath()
          navigate(nextPath, { replace: true })
          return
        }

        setIsLoading(false)
      } catch (error) {
        if (isMounted) {
          logDevError('onboarding language load', {
            error: error instanceof Error ? error.message : String(error),
          })
          setErrorMessage(userFacingMessage(error, t('onboarding.language.loadFailed')))
          setIsLoading(false)
        }
      }
    }

    void verifyAccess()

    return () => {
      isMounted = false
    }
  }, [navigate, t])

  async function handleSelect(language: SupportedLanguage) {
    setSelected(language)
    setErrorMessage(null)
    try {
      await changeAppLanguage(language)
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : t('onboarding.language.previewFailed'),
      )
    }
  }

  async function handleContinue() {
    setErrorMessage(null)
    setIsSubmitting(true)

    try {
      await savePreferredLanguage(selected)
      const nextPath = await resolveCurrentOnboardingPath()
      navigate(nextPath, { replace: true })
    } catch (error) {
      logDevError('onboarding language save', {
        error: error instanceof Error ? error.message : String(error),
      })
      setErrorMessage(userFacingMessage(error, t('onboarding.language.saveFailed')))
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-ink-muted">
        {t('onboarding.preparingWorkspace')}
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10 font-sans text-ink antialiased">
      <div className="w-full max-w-lg rounded-[2rem] border border-border-hairline bg-canvas-raised p-6 shadow-[0_16px_40px_rgba(28,27,41,0.06)] sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-primary">
          {t('onboarding.language.eyebrow')}
        </p>
        <h1 className="mt-3 font-serif text-3xl text-ink sm:text-4xl">
          {t('onboarding.language.title')}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          {t('onboarding.language.subtitle')}
        </p>

        {errorMessage ? (
          <div
            className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700"
            role="alert"
          >
            {errorMessage}
          </div>
        ) : null}

        <div
          className="mt-6 grid gap-3"
          role="radiogroup"
          aria-label={t('onboarding.language.title')}
        >
          {SUPPORTED_LANGUAGES.map((language) => {
            const isSelected = selected === language
            return (
              <button
                key={language}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => void handleSelect(language)}
                disabled={isSubmitting}
                className={`flex items-center justify-between rounded-2xl border px-4 py-3.5 text-left transition disabled:opacity-60 ${
                  isSelected
                    ? 'border-accent-primary bg-accent-primary-soft text-accent-primary-deep'
                    : 'border-border-hairline bg-canvas text-ink hover:bg-accent-primary-soft/60'
                }`}
              >
                <span className="text-base font-medium">
                  {LANGUAGE_NATIVE_NAMES[language]}
                </span>
                <span className="text-xs uppercase tracking-wide text-ink-muted">
                  {language}
                </span>
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => void handleContinue()}
          disabled={isSubmitting}
          className="mt-7 w-full rounded-full bg-accent-primary px-5 py-3 text-sm font-medium text-white transition hover:bg-accent-primary-deep disabled:opacity-60"
        >
          {isSubmitting
            ? t('onboarding.language.saving')
            : t('onboarding.language.continue')}
        </button>
      </div>
    </div>
  )
}
