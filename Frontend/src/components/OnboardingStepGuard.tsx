import { Navigate } from 'react-router-dom'
import { useOnboardingStepGuard } from '../hooks/useOnboardingStepGuard'
import type { OnboardingStep } from '../lib/onboarding'

type OnboardingStepGuardProps = {
  expectedStep: OnboardingStep
  children: React.ReactNode
}

export function OnboardingStepGuard({ expectedStep, children }: OnboardingStepGuardProps) {
  const state = useOnboardingStepGuard({ expectedStep })

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas text-ink-muted">
        Preparing your workspace…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-4">
        <div className="max-w-md rounded-[2rem] border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
          {state.message}
        </div>
      </div>
    )
  }

  if (state.status === 'redirect') {
    return <Navigate to={state.path} replace />
  }

  return <>{children}</>
}
