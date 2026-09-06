import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthAlert, PrimaryButton } from '../auth/AuthButtons'
import { AuthFormField } from '../auth/AuthFormField'
import type { CompetitorDraft } from '../../hooks/useCompetitorIntake'
import {
  MAX_COMPETITORS_PER_AVATAR,
  RECOMMENDED_COMPETITORS_PER_AVATAR,
} from '../../lib/competitors'
import type { CompetitorPlatform } from '../../types/contos'

export type CompetitorsStepProps = {
  competitorInputs: CompetitorDraft[]
  fieldErrors: Record<string, string>
  errorMessage: string | null
  isSubmitting: boolean
  minCompetitors: number
  maxCompetitors: number
  onUpdateInput: (index: number, value: string) => void
  onUpdatePlatform: (index: number, platform: CompetitorPlatform) => void
  onAddField: () => void
  onRemoveField: (index: number) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onBack: () => void
  onSignOut?: () => void
  isSigningOut?: boolean
}

export function CompetitorsStepLoading() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas text-ink-muted">
      {t('onboarding.competitors.loading')}
    </div>
  )
}

export function CompetitorsStepUnavailable({
  message,
  onSignOut,
  isSigningOut = false,
}: {
  message: string
  onSignOut?: () => void
  isSigningOut?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="max-w-md space-y-4 rounded-[2rem] border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
        <p>{message}</p>
        {onSignOut ? (
          <button
            type="button"
            onClick={onSignOut}
            disabled={isSigningOut}
            className="rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:opacity-60"
          >
            {isSigningOut ? t('common.signingOut') : t('common.signOut')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function CompetitorsStep({
  competitorInputs,
  fieldErrors,
  errorMessage,
  isSubmitting,
  minCompetitors,
  maxCompetitors,
  onUpdateInput,
  onUpdatePlatform,
  onAddField,
  onRemoveField,
  onSubmit,
  onBack,
  onSignOut,
  isSigningOut = false,
}: CompetitorsStepProps) {
  const { t } = useTranslation()

  return (
    <div className="min-h-dvh overflow-y-auto bg-canvas px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-accent-primary">{t('layout.brandName')}</p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">
              {t('onboarding.competitors.title')}
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              {t('onboarding.competitors.body', {
                min: minCompetitors,
                max: maxCompetitors,
                recommended: RECOMMENDED_COMPETITORS_PER_AVATAR,
              })}
            </p>
          </div>
          {onSignOut ? (
            <button
              type="button"
              onClick={onSignOut}
              disabled={isSubmitting || isSigningOut}
              className="shrink-0 rounded-full border border-border-hairline bg-white px-4 py-2 text-sm text-ink transition hover:bg-accent-primary-soft disabled:opacity-60"
            >
              {isSigningOut ? t('common.signingOut') : t('common.signOut')}
            </button>
          ) : null}
        </div>

        <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8">
          {errorMessage ? (
            <div className="mb-6">
              <AuthAlert message={errorMessage} />
            </div>
          ) : null}

          <form className="space-y-6" onSubmit={onSubmit}>
            <div className="space-y-4">
              {competitorInputs.map((entry, index) => (
                <div key={`competitor-${index}`} className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={entry.platform}
                      onChange={(event) =>
                        onUpdatePlatform(index, event.target.value as CompetitorPlatform)
                      }
                      className="rounded-xl border border-border-hairline bg-canvas px-3 py-2 text-sm text-ink"
                    >
                      <option value="instagram">{t('onboarding.competitors.platformInstagram')}</option>
                      <option value="linkedin">{t('onboarding.competitors.platformLinkedIn')}</option>
                    </select>
                    {competitorInputs.length > minCompetitors ? (
                      <button
                        type="button"
                        onClick={() => onRemoveField(index)}
                        className="rounded-xl border border-border-hairline px-3 py-2 text-sm text-ink-muted hover:bg-accent-primary-soft"
                      >
                        {t('onboarding.competitors.remove')}
                      </button>
                    ) : null}
                  </div>
                  <AuthFormField
                    label={t('onboarding.competitors.competitorLabel', { n: index + 1 })}
                    name={`competitor-${index}`}
                    placeholder={
                      entry.platform === 'linkedin'
                        ? t('onboarding.competitors.placeholderLinkedIn')
                        : t('onboarding.competitors.placeholderInstagram')
                    }
                    value={entry.value}
                    onChange={(event) => onUpdateInput(index, event.target.value)}
                    error={fieldErrors[`competitor-${index}`]}
                  />
                </div>
              ))}
            </div>

            {competitorInputs.length < MAX_COMPETITORS_PER_AVATAR ? (
              <button
                type="button"
                onClick={onAddField}
                className="rounded-xl border border-dashed border-border-hairline px-4 py-3 text-sm font-medium text-accent-primary hover:bg-accent-primary-soft"
              >
                {t('onboarding.competitors.addCompetitor')}
              </button>
            ) : (
              <p className="text-sm text-ink-muted">
                {t('onboarding.competitors.maxReached', { max: MAX_COMPETITORS_PER_AVATAR })}
              </p>
            )}

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={onBack}
                disabled={isSubmitting || isSigningOut}
                className="rounded-xl border border-border-hairline px-4 py-3 text-sm font-medium text-ink transition hover:bg-accent-primary-soft disabled:opacity-60"
              >
                {t('onboarding.competitors.back')}
              </button>
              <PrimaryButton disabled={isSubmitting || isSigningOut}>
                {isSubmitting
                  ? t('onboarding.competitors.submitting')
                  : t('onboarding.competitors.submit')}
              </PrimaryButton>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}
