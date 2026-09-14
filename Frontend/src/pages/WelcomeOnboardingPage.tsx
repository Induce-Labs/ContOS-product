import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import welcomeCard1 from '../assets/welcome-card-1.png'
import welcomeCard2 from '../assets/welcome-card-2.png'
import welcomeCard3 from '../assets/welcome-card-3.png'
import welcomeCard4 from '../assets/welcome-card-4.png'
import { isOnboardingComplete, advanceOnboardingStep, getOnboardingStep, resolveOnboardingPath } from '../lib/onboarding'
import { resolveDashboardPath } from '../lib/projects'

type OnboardingModule = {
  number: '01' | '02' | '03' | '04'
  illustration: 'intelligence' | 'profiling' | 'cmo' | 'agents'
}

const ONBOARDING_MODULES: OnboardingModule[] = [
  { number: '01', illustration: 'intelligence' },
  { number: '02', illustration: 'profiling' },
  { number: '03', illustration: 'cmo' },
  { number: '04', illustration: 'agents' },
]

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

function ModuleIllustration({
  type,
}: {
  type: OnboardingModule['illustration']
}) {
  if (type === 'intelligence') {
    return (
      <img
        src={welcomeCard1}
        alt=""
        className="h-full w-full object-cover"
      />
    )
  }

  if (type === 'profiling') {
    return (
      <img
        src={welcomeCard2}
        alt=""
        className="h-full w-full object-cover"
      />
    )
  }

  if (type === 'cmo') {
    return (
      <img
        src={welcomeCard3}
        alt=""
        className="h-full w-full object-cover"
      />
    )
  }

  return (
    <img
      src={welcomeCard4}
      alt=""
      className="h-full w-full object-cover"
    />
  )
}

function OnboardingModuleCard({ module }: { module: OnboardingModule }) {
  const { t } = useTranslation()

  return (
    <article className="welcome-module-card flex w-[272px] shrink-0 flex-col rounded-[24px] border border-[#ede7de] bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.03)] sm:w-[280px] sm:p-5">
      <span className="relative z-[1] mb-3 block font-mono text-[13px] font-medium tracking-wider text-neutral-400">
        {module.number}
      </span>

      <div className="relative z-[1] mb-4 aspect-[4/3] w-full overflow-hidden rounded-2xl border border-black/[0.03] bg-[#f4ece3] shadow-inner">
        <ModuleIllustration type={module.illustration} />
      </div>

      <h2 className="relative z-[1] mb-2 font-sans text-[18px] font-bold leading-[1.22] tracking-[-0.02em] text-neutral-900 sm:text-[19px]">
        {t(`onboarding.welcome.modules.${module.number}.title`)}
      </h2>

      <p className="relative z-[1] text-[13px] leading-[1.5] text-neutral-500">
        {t(`onboarding.welcome.modules.${module.number}.description`)}
      </p>
    </article>
  )
}

export function WelcomeOnboardingPage() {
  const { t } = useTranslation()
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
              : t('onboarding.welcome.loadStateFailed'),
          )
          setIsLoading(false)
        }
      }
    }

    void verifyAccess()

    return () => {
      isMounted = false
    }
  }, [navigate, t])

  async function handleContinue() {
    setErrorMessage(null)
    setIsSubmitting(true)

    try {
      await advanceOnboardingStep('project_type')
      navigate('/onboarding/project', { replace: true })
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t('onboarding.welcome.completeFailed'),
      )
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
    <div className="relative min-h-dvh overflow-auto bg-[#faf9fd] font-sans text-[#1c1c1c] antialiased selection:bg-neutral-900 selection:text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(238,230,253,0.65)_0%,rgba(247,244,253,0.35)_45%,rgba(255,255,255,0)_80%),radial-gradient(circle_at_100%_100%,rgba(235,225,252,0.4)_0%,rgba(255,255,255,0)_50%)]"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-black/[0.12] via-black/[0.02] to-transparent sm:h-28"
      />

      <main className="relative z-20 mx-auto flex min-h-dvh w-full max-w-[1320px] flex-col items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
        <header className="mx-auto max-w-3xl shrink-0 text-center">
          <h1 className="font-sans text-[32px] font-bold leading-[1.1] tracking-[-0.03em] text-neutral-900 sm:text-[40px] md:text-[46px]">
            {t('onboarding.welcome.title')}
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm font-normal leading-relaxed text-neutral-500 sm:text-base">
            {t('onboarding.welcome.subtitle')}
          </p>
        </header>

        {errorMessage ? (
          <div
            className="mx-auto mt-4 w-full max-w-3xl shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700"
            role="alert"
          >
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-8 w-full max-w-full overflow-x-auto overscroll-x-contain sm:mt-10">
          <div className="mx-auto flex w-max items-stretch gap-4 px-2 py-3 sm:gap-5">
            {ONBOARDING_MODULES.map((module) => (
              <OnboardingModuleCard key={module.number} module={module} />
            ))}
          </div>
        </div>

        <div className="mt-8 flex shrink-0 justify-center sm:mt-10">
          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={isSubmitting}
            className="group inline-flex cursor-pointer items-center gap-2.5 rounded-full bg-[#9353ea] px-8 py-3 text-sm font-medium tracking-normal text-white shadow-[0_10px_30px_rgba(147,83,234,0.4)] transition-all duration-300 hover:scale-105 hover:bg-[#823fe0] hover:shadow-[0_14px_35px_rgba(147,83,234,0.5)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100 sm:px-9 sm:py-3.5 sm:text-[15px]"
          >
            <span>{isSubmitting ? t('onboarding.welcome.starting') : t('onboarding.welcome.cta')}</span>
            <ArrowIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </button>
        </div>
      </main>
    </div>
  )
}
