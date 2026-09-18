import { useEffect, useState } from 'react'
import {
  getOnboardingStep,
  isOnboardingComplete,
  needsLanguageSelection,
  ONBOARDING_LANGUAGE_PATH,
  resolveOnboardingPath,
  type OnboardingStep,
} from '../lib/onboarding'
import { resolveDashboardPath } from '../lib/projects'

type UseOnboardingStepGuardOptions = {
  expectedStep: OnboardingStep
}

export type OnboardingStepGuardState =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'redirect'; path: string }
  | { status: 'error'; message: string }

export function useOnboardingStepGuard({
  expectedStep,
}: UseOnboardingStepGuardOptions): OnboardingStepGuardState {
  const [state, setState] = useState<OnboardingStepGuardState>({ status: 'loading' })

  useEffect(() => {
    let isMounted = true

    async function verifyStep() {
      try {
        const completed = await isOnboardingComplete()

        if (!isMounted) {
          return
        }

        if (completed) {
          const dashboardPath = await resolveDashboardPath()
          setState({ status: 'redirect', path: dashboardPath })
          return
        }

        if (await needsLanguageSelection()) {
          if (!isMounted) {
            return
          }
          setState({ status: 'redirect', path: ONBOARDING_LANGUAGE_PATH })
          return
        }

        const currentStep = await getOnboardingStep()

        if (!isMounted) {
          return
        }

        if (currentStep !== expectedStep) {
          setState({ status: 'redirect', path: resolveOnboardingPath(currentStep) })
          return
        }

        setState({ status: 'ready' })
      } catch (error) {
        if (isMounted) {
          setState({
            status: 'error',
            message:
              error instanceof Error
                ? error.message
                : 'Failed to verify onboarding step unexpectedly',
          })
        }
      }
    }

    void verifyStep()

    return () => {
      isMounted = false
    }
  }, [expectedStep])

  return state
}
