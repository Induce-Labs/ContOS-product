import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthAlert } from '../auth/AuthButtons'
import type { ProjectType } from '../../types/contos'

export type ProjectTypeOption = {
  value: ProjectType
  title: string
  description: string
  icon: 'user' | 'store' | 'building'
}

export const PROJECT_TYPE_OPTIONS: ProjectTypeOption[] = [
  {
    value: 'personal_branding',
    title: 'Personal Brand',
    description:
      'Focus on thought leadership, audience growth, and individual positioning.',
    icon: 'user',
  },
  {
    value: 'business_1',
    title: 'Business 1',
    description: 'Standard setup for a specific product line or service offering.',
    icon: 'store',
  },
  {
    value: 'business_2',
    title: 'Business 2',
    description:
      'Setup for a secondary venture, agency, or distinct corporate entity.',
    icon: 'building',
  },
]

function projectTypeOptionKeys(value: ProjectType): {
  title: string
  description: string
} {
  switch (value) {
    case 'personal_branding':
      return {
        title: 'onboarding.projectType.options.personalBrand.title',
        description: 'onboarding.projectType.options.personalBrand.description',
      }
    case 'business_1':
      return {
        title: 'onboarding.projectType.options.business1.title',
        description: 'onboarding.projectType.options.business1.description',
      }
    case 'business_2':
      return {
        title: 'onboarding.projectType.options.business2.title',
        description: 'onboarding.projectType.options.business2.description',
      }
    default:
      return {
        title: 'onboarding.projectType.options.personalBrand.title',
        description: 'onboarding.projectType.options.personalBrand.description',
      }
  }
}

function ArrowIcon({ className }: { className?: string }) {
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

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  )
}

function ProjectTypeIcon({ icon }: { icon: ProjectTypeOption['icon'] }) {
  if (icon === 'user') {
    return (
      <svg
        className="h-5 w-5 text-ink-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c1.2-3 3.4-4.5 7-4.5s5.8 1.5 7 4.5" strokeLinecap="round" />
      </svg>
    )
  }

  if (icon === 'store') {
    return (
      <svg
        className="h-5 w-5 text-ink-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      >
        <path d="M4 10 6 5h12l2 5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 10v9h14v-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 19v-4h6v4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  return (
    <svg
      className="h-5 w-5 text-ink-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <rect x="5" y="6" width="14" height="14" rx="1.5" />
      <path d="M9 6V4h6v2" strokeLinecap="round" />
      <path d="M8 11h2M8 14h2M14 11h2M14 14h2" strokeLinecap="round" />
    </svg>
  )
}

export type ProjectTypeStepProps = {
  selectedType: ProjectType | null
  onSelect: (type: ProjectType) => void
  onContinue: () => void
  isSubmitting: boolean
  errorMessage: string | null
  fieldError: string | null
  backControl: ReactNode
  stepLabel?: string
}

export function ProjectTypeStep({
  selectedType,
  onSelect,
  onContinue,
  isSubmitting,
  errorMessage,
  fieldError,
  backControl,
  stepLabel,
}: ProjectTypeStepProps) {
  const { t } = useTranslation()
  const resolvedStepLabel = stepLabel ?? t('onboarding.projectType.stepLabel')

  return (
    <div className="relative min-h-dvh overflow-auto bg-canvas font-sans text-ink antialiased selection:bg-ink selection:text-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(238,230,253,0.6)_0%,rgba(247,244,253,0.3)_45%,rgba(255,255,255,0)_80%),radial-gradient(circle_at_100%_100%,rgba(235,225,252,0.4)_0%,rgba(255,255,255,0)_50%)] dark:bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(37,22,77,0.5)_0%,rgba(3,3,4,0.2)_45%,rgba(3,3,4,0)_80%),radial-gradient(circle_at_100%_100%,rgba(37,22,77,0.35)_0%,rgba(3,3,4,0)_50%)]"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-black/[0.12] via-black/[0.02] to-transparent sm:h-32 dark:from-white/[0.06]"
      />

      <main className="relative z-20 mx-auto flex min-h-dvh w-full max-w-[1180px] flex-col px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <div className="flex shrink-0 items-center justify-between gap-4">
          <div className="project-type-back min-w-0">{backControl}</div>
          <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted sm:text-xs">
            {resolvedStepLabel}
          </span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-10 sm:py-14">
          <header className="mx-auto max-w-2xl shrink-0 text-center">
            <h1 className="mb-3 break-words text-balance font-serif text-[34px] font-bold leading-[1.12] tracking-[-0.03em] text-ink sm:text-[44px] md:text-[50px]">
              {t('onboarding.projectType.title')}
            </h1>
            <p className="mx-auto max-w-lg break-words text-sm leading-relaxed text-ink-muted sm:text-base">
              {t('onboarding.projectType.subtitle')}
            </p>
          </header>

          {errorMessage ? (
            <div className="mx-auto mt-6 w-full max-w-3xl shrink-0">
              <AuthAlert message={errorMessage} />
            </div>
          ) : null}

          <div className="scrollbar-none mt-10 w-full max-w-full overflow-x-auto overscroll-x-contain sm:mt-12">
            <div className="mx-auto flex w-max items-stretch gap-5 px-2 py-1 sm:gap-6">
              {PROJECT_TYPE_OPTIONS.map((option) => {
                const isSelected = selectedType === option.value
                const keys = projectTypeOptionKeys(option.value)

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onSelect(option.value)}
                    aria-pressed={isSelected}
                    className={`contos-glow-card flex w-[min(100%,300px)] min-w-[260px] shrink-0 cursor-pointer flex-col rounded-[28px] bg-canvas-raised p-7 text-left transition-shadow duration-300 sm:w-[300px] sm:min-w-[280px] sm:p-8 ${
                      isSelected
                        ? 'contos-glow-card--selected border-2 border-ink shadow-[0_12px_32px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.35)]'
                        : 'border border-transparent shadow-[0_8px_30px_rgba(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.28)]'
                    }`}
                  >
                    {isSelected ? (
                      <span className="absolute right-5 top-5 z-[1] flex h-6 w-6 items-center justify-center rounded-full bg-ink text-canvas">
                        <CheckIcon className="h-3.5 w-3.5" />
                      </span>
                    ) : null}

                    <div className="relative z-[1] mb-6 flex h-11 w-11 items-center justify-center rounded-full bg-canvas">
                      <ProjectTypeIcon icon={option.icon} />
                    </div>

                    <h2 className="relative z-[1] mb-2.5 break-words text-balance font-serif text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-ink sm:text-[24px]">
                      {t(keys.title)}
                    </h2>

                    <p className="relative z-[1] break-words text-[13.5px] leading-relaxed text-ink-muted sm:text-[14px]">
                      {t(keys.description)}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          {fieldError ? (
            <p className="mt-4 shrink-0 text-center text-sm text-red-600 dark:text-red-400">{fieldError}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 justify-end pb-2 sm:pb-4">
          <button
            type="button"
            onClick={onContinue}
            disabled={isSubmitting}
            className="contos-btn contos-btn--pill contos-btn--primary group max-w-full whitespace-normal sm:px-8 sm:py-3.5 sm:text-[14.5px]"
          >
            <span className="text-left">
              {isSubmitting
                ? t('onboarding.projectType.creating')
                : t('onboarding.projectType.continue')}
            </span>
            <ArrowIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </button>
        </div>
      </main>
    </div>
  )
}
