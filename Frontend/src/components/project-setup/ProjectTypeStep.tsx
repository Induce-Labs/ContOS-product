import type { ReactNode } from 'react'
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
      'Tailor insights and strategy for your personal brand, audience, and content voice.',
    icon: 'user',
  },
  {
    value: 'business_1',
    title: 'Business 1',
    description:
      'Tailor insights and strategy for your first business workspace and market positioning.',
    icon: 'store',
  },
  {
    value: 'business_2',
    title: 'Business 2',
    description:
      'Tailor insights and strategy for your second business workspace and growth goals.',
    icon: 'building',
  },
]

function ProjectTypeIcon({ icon }: { icon: ProjectTypeOption['icon'] }) {
  if (icon === 'user') {
    return (
      <svg className="h-5 w-5 text-ink" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20c1.2-3 3.4-4.5 7-4.5s5.8 1.5 7 4.5" strokeLinecap="round" />
      </svg>
    )
  }

  if (icon === 'store') {
    return (
      <svg className="h-5 w-5 text-ink" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M4 10 6 5h12l2 5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 10v9h14v-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9 19v-4h6v4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  return (
    <svg className="h-5 w-5 text-ink" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
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
  stepLabel = 'Workspace Setup · Step 2',
}: ProjectTypeStepProps) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_#f3ecff_0%,_#faf9f7_42%,_#faf9f7_100%)] px-4 py-5 sm:px-6 sm:py-6 lg:px-10">
      <div className="mx-auto flex h-full w-full max-w-[1180px] min-w-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4">
          {backControl}
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-ink-muted">
            {stepLabel}
          </p>
        </header>

        <div className="mt-8 shrink-0 text-center sm:mt-10">
          <h1 className="font-serif text-4xl leading-tight text-ink sm:text-5xl lg:text-[3.25rem]">
            Start a New Project
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-ink-muted sm:text-base">
            Select the primary focus for this workspace to tailor the insights and strategy.
          </p>
        </div>

        {errorMessage ? (
          <div className="mx-auto mt-5 w-full max-w-3xl shrink-0">
            <AuthAlert message={errorMessage} />
          </div>
        ) : null}

        <section className="mt-8 grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto sm:mt-10 md:grid-cols-3 md:gap-5">
          {PROJECT_TYPE_OPTIONS.map((option) => {
            const isSelected = selectedType === option.value

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onSelect(option.value)}
                className={`relative flex min-h-[260px] min-w-0 flex-col rounded-[1.75rem] p-6 text-left transition sm:min-h-[300px] sm:p-7 ${
                  isSelected
                    ? 'border-2 border-ink bg-white'
                    : 'border border-transparent bg-white shadow-[0_18px_45px_rgba(28,27,41,0.06)] hover:shadow-[0_22px_50px_rgba(28,27,41,0.08)]'
                }`}
              >
                {isSelected ? (
                  <span className="absolute right-5 top-5 flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-white">
                    ✓
                  </span>
                ) : null}

                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#f3f0eb]">
                  <ProjectTypeIcon icon={option.icon} />
                </span>

                <div className="mt-auto space-y-3 pt-10">
                  <h2 className="font-serif text-2xl leading-tight text-ink sm:text-[1.7rem]">
                    {option.title}
                  </h2>
                  <p className="text-sm leading-relaxed text-ink-muted">{option.description}</p>
                </div>
              </button>
            )
          })}
        </section>

        {fieldError ? (
          <p className="mt-4 shrink-0 text-center text-sm text-red-600">{fieldError}</p>
        ) : null}

        <div className="flex shrink-0 justify-end pt-5 sm:pt-6">
          <button
            type="button"
            onClick={onContinue}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-accent-primary to-[#8d67cf] px-8 py-3.5 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(116,79,185,0.32)] transition hover:from-accent-primary-deep hover:to-accent-primary disabled:cursor-not-allowed disabled:opacity-60 sm:px-10 sm:text-base"
          >
            {isSubmitting ? 'Creating…' : 'Continue'}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  )
}
