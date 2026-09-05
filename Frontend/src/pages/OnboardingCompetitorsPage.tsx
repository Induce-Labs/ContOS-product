import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { OnboardingStepGuard } from '../components/OnboardingStepGuard'
import {
  CompetitorsStep,
  CompetitorsStepLoading,
  CompetitorsStepUnavailable,
} from '../components/project-setup/CompetitorsStep'
import { useAuth } from '../hooks/useAuth'
import { useCompetitorIntake } from '../hooks/useCompetitorIntake'
import { fetchAvatar, type Avatar } from '../lib/avatars'
import { completeOnboarding, getOnboardingAvatarId } from '../lib/onboarding'

function OnboardingCompetitorsContent() {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const [avatar, setAvatar] = useState<Avatar | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isSigningOut, setIsSigningOut] = useState(false)

  const {
    competitorInputs,
    fieldErrors,
    errorMessage,
    isSubmitting,
    setErrorMessage,
    updateCompetitorInput,
    updateCompetitorPlatform,
    addCompetitorField,
    removeCompetitorField,
    submitCompetitors,
    minCompetitors,
    maxCompetitors,
  } = useCompetitorIntake()

  useEffect(() => {
    let isMounted = true

    async function loadAvatar() {
      try {
        const avatarId = await getOnboardingAvatarId()

        if (!avatarId) {
          throw new Error('Onboarding avatar is missing. Return to project setup and try again.')
        }

        const loadedAvatar = await fetchAvatar(avatarId)

        if (isMounted) {
          setAvatar(loadedAvatar)
          setIsLoading(false)
        }
      } catch (error) {
        if (isMounted) {
          setLoadError(
            error instanceof Error ? error.message : 'Failed to load onboarding avatar.',
          )
          setIsLoading(false)
        }
      }
    }

    void loadAvatar()

    return () => {
      isMounted = false
    }
  }, [])

  async function handleSignOut() {
    setIsSigningOut(true)
    setErrorMessage(null)
    try {
      // Force clears a broken/expired session so the user can reach /login again.
      await signOut({ force: true })
      navigate('/login', { replace: true })
    } catch (error) {
      setIsSigningOut(false)
      const message = error instanceof Error ? error.message : 'Sign out failed.'
      setErrorMessage(message)
      setLoadError(message)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!avatar) {
      return
    }

    const success = await submitCompetitors(avatar.id)

    if (!success) {
      return
    }

    await completeOnboarding()
    navigate(`/dashboard/${avatar.id}`, { replace: true })
  }

  if (isLoading) {
    return <CompetitorsStepLoading />
  }

  if (loadError || !avatar) {
    return (
      <CompetitorsStepUnavailable
        message={loadError ?? 'Competitor setup is unavailable.'}
        onSignOut={() => void handleSignOut()}
        isSigningOut={isSigningOut}
      />
    )
  }

  return (
    <CompetitorsStep
      competitorInputs={competitorInputs}
      fieldErrors={fieldErrors}
      errorMessage={errorMessage}
      isSubmitting={isSubmitting}
      minCompetitors={minCompetitors}
      maxCompetitors={maxCompetitors}
      onUpdateInput={updateCompetitorInput}
      onUpdatePlatform={updateCompetitorPlatform}
      onAddField={addCompetitorField}
      onRemoveField={removeCompetitorField}
      onSubmit={(event) => void handleSubmit(event)}
      onBack={() => navigate('/onboarding/profiling', { replace: true })}
      onSignOut={() => void handleSignOut()}
      isSigningOut={isSigningOut}
    />
  )
}

export function OnboardingCompetitorsPage() {
  return (
    <OnboardingStepGuard expectedStep="competitors">
      <OnboardingCompetitorsContent />
    </OnboardingStepGuard>
  )
}
