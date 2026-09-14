import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthAlert } from '../auth/AuthButtons'
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

function SparklesIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M12 2.5 13.2 8.3 19 9.5l-5.8 1.2L12 16.5l-1.2-5.8L5 9.5l5.8-1.2L12 2.5Z" />
      <path d="M18.5 14.5 19.1 17 21.5 17.6 19.1 18.2 18.5 20.7 17.9 18.2 15.5 17.6 17.9 17 18.5 14.5Z" />
    </svg>
  )
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      className={className}
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function LinkedInIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M6.5 9.5H3.7V20h2.8V9.5ZM5.1 4a1.65 1.65 0 1 0 0 3.3 1.65 1.65 0 0 0 0-3.3ZM20.3 20h-2.8v-5.6c0-1.6-.6-2.7-2.1-2.7-1.1 0-1.7.7-2 1.4-.1.3-.1.6-.1.9V20h-2.8s.04-9.2 0-10.5h2.8v1.5c.4-.6 1.1-1.7 2.8-1.7 2 0 3.5 1.3 3.5 4.2V20Z" />
    </svg>
  )
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}

function PlatformPicker({
  platform,
  disabled,
  onChange,
  instagramLabel,
  linkedinLabel,
}: {
  platform: CompetitorPlatform
  disabled: boolean
  onChange: (platform: CompetitorPlatform) => void
  instagramLabel: string
  linkedinLabel: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  const isInstagram = platform === 'instagram'

  return (
    <div ref={rootRef} className="relative w-full shrink-0 sm:w-48">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-neutral-200 bg-[#faf9fd] px-4 py-2.5 text-left text-xs font-medium text-neutral-800 transition-all hover:border-neutral-300 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {isInstagram ? (
            <InstagramIcon className="h-4 w-4 shrink-0 text-pink-600" />
          ) : (
            <LinkedInIcon className="h-4 w-4 shrink-0 text-blue-600" />
          )}
          <span className="truncate">{isInstagram ? instagramLabel : linkedinLabel}</span>
        </span>
        <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1.5 rounded-xl border border-neutral-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="option"
            aria-selected={isInstagram}
            onClick={() => {
              onChange('instagram')
              setOpen(false)
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-900"
          >
            <InstagramIcon className="h-4 w-4 text-pink-600" />
            <span>{instagramLabel}</span>
          </button>
          <button
            type="button"
            role="option"
            aria-selected={!isInstagram}
            onClick={() => {
              onChange('linkedin')
              setOpen(false)
            }}
            className="flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50 hover:text-neutral-900"
          >
            <LinkedInIcon className="h-4 w-4 text-blue-600" />
            <span>{linkedinLabel}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
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
  const disabled = isSubmitting || isSigningOut
  const count = competitorInputs.length
  const atRecommended = count >= RECOMMENDED_COMPETITORS_PER_AVATAR
  const submitLabel = isSubmitting
    ? t('onboarding.competitors.submitting')
    : t('onboarding.competitors.submit')
  const addLabel = t('onboarding.competitors.addCompetitor').replace(/^\+\s*/u, '')
  const submitDisplay = submitLabel.replace(/\s*→\s*$/u, '')

  return (
    <div className="relative min-h-dvh overflow-auto bg-[#faf9fd] font-sans text-[#1c1c1c] antialiased selection:bg-neutral-900 selection:text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_75%_55%_at_15%_10%,rgba(238,230,253,0.55)_0%,rgba(247,244,253,0.25)_45%,rgba(255,255,255,0)_75%),radial-gradient(ellipse_70%_50%_at_85%_90%,rgba(235,225,252,0.45)_0%,rgba(247,244,253,0.2)_40%,rgba(255,255,255,0)_70%)]"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-black/[0.12] via-black/[0.02] to-transparent sm:h-36"
      />

      <main className="relative z-20 mx-auto flex w-full max-w-4xl flex-col px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        {onSignOut ? (
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={onSignOut}
              disabled={disabled}
              className="shrink-0 rounded-full border border-[#ede7de] bg-white px-4 py-2 text-sm text-neutral-700 transition hover:bg-purple-50 disabled:opacity-60"
            >
              {isSigningOut ? t('common.signingOut') : t('common.signOut')}
            </button>
          </div>
        ) : null}

        <header className="mx-auto mb-8 max-w-2xl text-center sm:mb-10">
          <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-purple-200/60 bg-purple-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#9353ea]">
            <SparklesIcon className="h-3.5 w-3.5" />
            {t('layout.brandName')}
          </span>

          <h1 className="mb-3.5 font-serif text-[32px] font-bold leading-[1.12] tracking-[-0.03em] text-neutral-900 sm:text-[42px] md:text-[48px]">
            {t('onboarding.competitors.title')}
          </h1>

          <p className="mx-auto max-w-xl text-sm leading-relaxed text-neutral-500 sm:text-base">
            {t('onboarding.competitors.body', {
              min: minCompetitors,
              max: maxCompetitors,
              recommended: RECOMMENDED_COMPETITORS_PER_AVATAR,
            })}
          </p>
        </header>

        <div className="mb-6 flex w-full flex-col justify-between gap-3 rounded-2xl border border-[#ede7de] bg-white/80 p-4 text-xs backdrop-blur-sm sm:flex-row sm:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-neutral-800">
              {count} of {maxCompetitors}
            </span>
            <span className="text-neutral-400" aria-hidden="true">
              •
            </span>
            <span className={atRecommended ? 'font-medium text-emerald-600' : 'font-medium text-[#9353ea]'}>
              {atRecommended
                ? `${RECOMMENDED_COMPETITORS_PER_AVATAR}+`
                : `Recommend ${RECOMMENDED_COMPETITORS_PER_AVATAR}`}
            </span>
          </div>

          <div className="flex items-center gap-1.5" aria-hidden="true">
            {Array.from({ length: MAX_COMPETITORS_PER_AVATAR }).map((_, idx) => {
              const isFilled = idx < count
              const isRecommendedSlot = idx === RECOMMENDED_COMPETITORS_PER_AVATAR - 1

              return (
                <div
                  key={idx}
                  className={`h-2.5 w-2.5 rounded-full transition-all ${
                    isFilled
                      ? 'scale-110 bg-[#9353ea] shadow-sm'
                      : isRecommendedSlot
                        ? 'border-2 border-[#9353ea] bg-purple-100'
                        : 'bg-neutral-200'
                  }`}
                />
              )
            })}
          </div>
        </div>

        {errorMessage ? (
          <div className="mb-6">
            <AuthAlert message={errorMessage} />
          </div>
        ) : null}

        <form className="w-full" onSubmit={onSubmit}>
          <div className="mb-6 space-y-3.5">
            {competitorInputs.map((entry, index) => {
              const fieldKey = `competitor-${index}`
              const fieldError = fieldErrors[fieldKey]

              return (
                <div
                  key={fieldKey}
                  className="w-full rounded-[22px] border border-[#ede7de] bg-white p-4 shadow-[0_4px_20px_rgba(0,0,0,0.02)] sm:p-5"
                >
                  <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                    <div className="flex items-center justify-between gap-2 sm:justify-start">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-100 font-mono text-xs font-semibold text-neutral-400">
                        {String(index + 1).padStart(2, '0')}
                      </span>

                      {competitorInputs.length > minCompetitors ? (
                        <button
                          type="button"
                          onClick={() => onRemoveField(index)}
                          disabled={disabled}
                          className="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-red-500 disabled:opacity-60 sm:hidden"
                          aria-label={t('onboarding.competitors.remove')}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>

                    <PlatformPicker
                      platform={entry.platform}
                      disabled={disabled}
                      onChange={(platform) => onUpdatePlatform(index, platform)}
                      instagramLabel={t('onboarding.competitors.platformInstagram')}
                      linkedinLabel={t('onboarding.competitors.platformLinkedIn')}
                    />

                    <div className="min-w-0 flex-1">
                      <label className="sr-only" htmlFor={fieldKey}>
                        {t('onboarding.competitors.competitorLabel', { n: index + 1 })}
                      </label>
                      <input
                        id={fieldKey}
                        name={fieldKey}
                        type="text"
                        value={entry.value}
                        disabled={disabled}
                        onChange={(event) => onUpdateInput(index, event.target.value)}
                        placeholder={
                          entry.platform === 'linkedin'
                            ? t('onboarding.competitors.placeholderLinkedIn')
                            : t('onboarding.competitors.placeholderInstagram')
                        }
                        className="w-full rounded-xl border border-neutral-200 bg-[#faf9fd] px-4 py-2.5 font-mono text-xs text-neutral-900 placeholder:text-neutral-400 transition-all focus:border-[#9353ea] focus:outline-none focus:ring-2 focus:ring-[#9353ea]/10 disabled:opacity-60 sm:text-sm"
                      />
                      {fieldError ? (
                        <p className="mt-1.5 text-xs text-red-600">{fieldError}</p>
                      ) : null}
                    </div>

                    {competitorInputs.length > minCompetitors ? (
                      <button
                        type="button"
                        onClick={() => onRemoveField(index)}
                        disabled={disabled}
                        className="hidden shrink-0 cursor-pointer rounded-lg p-2 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-red-500 disabled:opacity-60 sm:flex"
                        aria-label={t('onboarding.competitors.remove')}
                        title={t('onboarding.competitors.remove')}
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="mb-8">
            {competitorInputs.length < MAX_COMPETITORS_PER_AVATAR ? (
              <button
                type="button"
                onClick={onAddField}
                disabled={disabled}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-300 py-3.5 text-xs font-medium text-neutral-600 transition-all duration-200 hover:border-[#9353ea] hover:bg-purple-50/40 hover:text-[#9353ea] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
              >
                <PlusIcon className="h-4 w-4" />
                <span>
                  {addLabel} ({count}/{MAX_COMPETITORS_PER_AVATAR})
                </span>
              </button>
            ) : (
              <div className="w-full rounded-2xl border border-neutral-200 bg-neutral-100/70 py-3 text-center text-xs font-medium text-neutral-500">
                {t('onboarding.competitors.maxReached', { max: MAX_COMPETITORS_PER_AVATAR })}
              </div>
            )}
          </div>

          <div className="flex w-full flex-col items-center justify-between gap-4 border-t border-neutral-200/80 pt-6 sm:flex-row">
            <button
              type="button"
              onClick={onBack}
              disabled={disabled}
              className="inline-flex items-center gap-2 self-start rounded-full px-2 py-3 text-xs font-medium text-neutral-500 transition-all hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto sm:px-3 sm:text-sm"
            >
              <span aria-hidden="true">←</span>
              <span>{t('onboarding.competitors.back')}</span>
            </button>

            <button
              type="submit"
              disabled={disabled}
              className="group inline-flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-[#9353ea] px-8 py-3.5 text-xs font-semibold text-white shadow-[0_10px_30px_rgba(147,83,234,0.4)] transition-all duration-300 hover:scale-105 hover:bg-[#823fe0] hover:shadow-[0_14px_35px_rgba(147,83,234,0.5)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 sm:w-auto sm:px-10 sm:py-4 sm:text-sm"
            >
              <span>{submitDisplay}</span>
              {!isSubmitting ? (
                <ArrowRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              ) : null}
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}
