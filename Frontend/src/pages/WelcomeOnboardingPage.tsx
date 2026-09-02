import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isOnboardingComplete, advanceOnboardingStep, getOnboardingStep, resolveOnboardingPath } from '../lib/onboarding'
import { resolveDashboardPath } from '../lib/projects'

type OnboardingModule = {
  number: string
  title: string
  description: string
  illustration: 'intelligence' | 'profiling' | 'cmo' | 'agents'
}

const ONBOARDING_MODULES: OnboardingModule[] = [
  {
    number: '01',
    title: 'Competitor Intelligence Engine',
    description:
      'Scrapes and analyzes competitor posts, hooks, and engagement so every strategy starts from real market data.',
    illustration: 'intelligence',
  },
  {
    number: '02',
    title: 'Brand Avatar Profiling',
    description:
      'Captures your audience, tone, and goals once so every output sounds like you — not generic AI.',
    illustration: 'profiling',
  },
  {
    number: '03',
    title: 'AI Fractional CMO',
    description:
      'Chat with a context-aware strategist that answers using your brand profile and live competitor research.',
    illustration: 'cmo',
  },
  {
    number: '04',
    title: 'Platform-Native Content Agents',
    description:
      'Generates LinkedIn, Instagram, X, and playbook content in native formats with reasoning behind each idea.',
    illustration: 'agents',
  },
]

function ModuleIllustration({ type }: { type: OnboardingModule['illustration'] }) {
  if (type === 'intelligence') {
    return (
      <div className="relative flex h-full min-h-[88px] items-center justify-center overflow-hidden rounded-xl bg-[#e8dfd2] sm:min-h-[100px] lg:min-h-[92px]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,_rgba(255,255,255,0.55),_transparent_55%)]" />
        <div className="relative h-14 w-14 rounded-full bg-gradient-to-br from-[#f6ead8] to-[#d8c2a2] shadow-[inset_0_2px_12px_rgba(255,255,255,0.65)] sm:h-16 sm:w-16" />
        <div className="absolute bottom-3 h-2 w-16 rounded-full bg-black/10 blur-md sm:bottom-4 sm:w-20" />
        <div className="absolute top-4 h-10 w-10 rotate-12 rounded-full border border-white/50 bg-gradient-to-br from-[#f3d7a8] via-[#e7b56d] to-[#c99552] opacity-90 shadow-lg sm:top-5 sm:h-12 sm:w-12" />
        <div className="absolute top-5 h-7 w-7 -rotate-6 rounded-full border border-white/40 bg-gradient-to-br from-[#f8e4bf] to-[#d7a86a] opacity-80 sm:top-6 sm:h-8 sm:w-8" />
      </div>
    )
  }

  if (type === 'profiling') {
    return (
      <div className="relative flex h-full min-h-[88px] items-center justify-center overflow-hidden rounded-xl bg-[#ebe3d8] sm:min-h-[100px] lg:min-h-[92px]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,_rgba(255,255,255,0.5),_transparent_60%)]" />
        <div className="relative w-[78%] rounded-xl border border-white/70 bg-white/85 p-2 shadow-[0_12px_28px_rgba(28,27,41,0.08)] backdrop-blur-sm sm:p-2.5">
          <div className="mb-2 flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-[#f0c7a6]" />
            <div className="h-2 w-2 rounded-full bg-[#e7d2b4]" />
            <div className="h-2 w-2 rounded-full bg-[#d8c4aa]" />
          </div>
          <div className="space-y-1.5">
            <div className="h-1.5 w-2/3 rounded-full bg-ink/10" />
            <div className="h-1.5 w-full rounded-full bg-ink/5" />
            <div className="mt-2 h-5 w-16 rounded-full bg-accent-primary/15 sm:w-20" />
          </div>
        </div>
      </div>
    )
  }

  if (type === 'cmo') {
    return (
      <div className="relative flex h-full min-h-[88px] items-end justify-center overflow-hidden rounded-xl bg-[#ece4da] sm:min-h-[100px] lg:min-h-[92px]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,_rgba(255,255,255,0.65),_transparent_70%)]" />
        <div className="relative mb-4 h-10 w-24 rounded-[1.25rem] bg-gradient-to-b from-white to-[#f1ebe4] shadow-[0_14px_24px_rgba(28,27,41,0.08)] sm:mb-5 sm:h-12 sm:w-28" />
        <div className="absolute bottom-3 h-2 w-20 rounded-full bg-black/10 blur-md sm:bottom-4 sm:w-24" />
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-[88px] items-center justify-center overflow-hidden rounded-xl bg-[#ebe2d7] sm:min-h-[100px] lg:min-h-[92px]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,_rgba(255,255,255,0.45),_transparent_55%)]" />
      <div className="relative w-[72%] rounded-xl border border-white/70 bg-white/90 p-2 shadow-[0_12px_24px_rgba(28,27,41,0.08)] sm:p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="h-1.5 w-12 rounded-full bg-ink/10" />
          <div className="rounded-full bg-accent-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-accent-primary">
            AI
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="h-1.5 w-full rounded-full bg-ink/5" />
          <div className="h-1.5 w-5/6 rounded-full bg-ink/5" />
          <div className="grid grid-cols-2 gap-1.5 pt-0.5">
            <div className="h-7 rounded-lg bg-[#f4ede4] sm:h-8" />
            <div className="h-7 rounded-lg bg-[#efe6dc] sm:h-8" />
          </div>
        </div>
      </div>
      <div className="absolute right-3 top-4 h-8 w-8 rotate-6 rounded-xl border border-white/60 bg-white/80 shadow-lg sm:right-4 sm:top-5 sm:h-9 sm:w-9" />
    </div>
  )
}

function OnboardingModuleCard({ module }: { module: OnboardingModule }) {
  return (
    <article className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.25rem] border border-white/70 bg-white/95 p-3 shadow-[0_12px_32px_rgba(28,27,41,0.06)] backdrop-blur-sm sm:rounded-[1.5rem] sm:p-4 lg:p-3.5 xl:p-4">
      <p className="text-xs font-medium text-ink-muted/70 sm:text-sm">{module.number}</p>

      <div className="my-3 min-h-0 flex-1 sm:my-4">
        <ModuleIllustration type={module.illustration} />
      </div>

      <div className="space-y-1.5 sm:space-y-2">
        <h2 className="font-serif text-base leading-tight text-ink sm:text-lg lg:text-[1.05rem] xl:text-xl">
          {module.title}
        </h2>
        <p className="text-xs leading-relaxed text-ink-muted sm:text-sm lg:text-[0.8rem] lg:leading-snug xl:text-sm">
          {module.description}
        </p>
        <p className="pt-0.5 text-xs text-ink-muted/80 sm:text-sm">
          Explore module <span aria-hidden="true">→</span>
        </p>
      </div>
    </article>
  )
}

export function WelcomeOnboardingPage() {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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

        const currentStep = await getOnboardingStep()

        if (currentStep !== 'welcome') {
          navigate(resolveOnboardingPath(currentStep), { replace: true })
          return
        }

        setIsLoading(false)
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : 'Failed to load onboarding state unexpectedly',
          )
          setIsLoading(false)
        }
      }
    }

    void verifyAccess()

    return () => {
      isMounted = false
    }
  }, [navigate])

  async function handleContinue() {
    setErrorMessage(null)
    setIsSubmitting(true)

    try {
      await advanceOnboardingStep('project_type')
      navigate('/onboarding/project', { replace: true })
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to complete onboarding unexpectedly',
      )
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-ink-muted">
        Preparing your workspace…
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_#f3ecff_0%,_#faf9f7_38%,_#faf9f7_100%)] px-3 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6">
      <div className="mx-auto flex h-full w-full max-w-[1280px] min-w-0 flex-col">
        <header className="shrink-0 text-center">
          <h1 className="font-serif text-3xl leading-tight text-ink sm:text-4xl lg:text-[2.75rem]">
            Welcome to ContOS.
          </h1>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-ink-muted sm:mt-3 sm:text-base">
            Your fractional CMO workspace. Let&apos;s set up your strategic foundation.
          </p>
        </header>

        {errorMessage ? (
          <div
            className="mx-auto mt-4 max-w-3xl shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {errorMessage}
          </div>
        ) : null}

        <section className="mt-4 grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-x-hidden overflow-y-auto sm:mt-5 sm:gap-4 lg:grid-cols-4 lg:gap-3 xl:gap-4">
          {ONBOARDING_MODULES.map((module) => (
            <OnboardingModuleCard key={module.number} module={module} />
          ))}
        </section>

        <div className="flex shrink-0 justify-center pt-4 sm:pt-5">
          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-accent-primary to-[#8d67cf] px-8 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(116,79,185,0.3)] transition hover:from-accent-primary-deep hover:to-accent-primary disabled:cursor-not-allowed disabled:opacity-60 sm:px-10 sm:py-3.5 sm:text-base"
          >
            {isSubmitting ? 'Starting…' : "Let's go"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  )
}
