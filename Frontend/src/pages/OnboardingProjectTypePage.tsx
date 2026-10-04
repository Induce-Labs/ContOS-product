import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { OnboardingStepGuard } from '../components/OnboardingStepGuard'
import { ProjectTypeStep } from '../components/project-setup/ProjectTypeStep'
import {
  MAX_AVATARS,
  createAvatar,
  defaultAvatarNameForType,
} from '../lib/avatars'
import { advanceOnboardingStep } from '../lib/onboarding'
import { logDevError, userFacingMessage } from '../lib/devLog'
import { setLastUsedProjectId } from '../lib/projects'
import type { ProjectType } from '../types/contos'

function OnboardingProjectTypeContent() {
  const navigate = useNavigate()
  const [selectedType, setSelectedType] = useState<ProjectType | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleContinue() {
    setErrorMessage(null)

    if (!selectedType) {
      setFieldError('Select a workspace type to continue.')
      return
    }

    setFieldError(null)
    setIsSubmitting(true)

    try {
      const avatar = await createAvatar(defaultAvatarNameForType(selectedType), selectedType)
      setLastUsedProjectId(avatar.id)
      await advanceOnboardingStep('profiling', {
        avatarId: avatar.id,
        projectType: selectedType,
      })
      navigate('/onboarding/profiling', { replace: true })
    } catch (error) {
      logDevError('onboarding create avatar', {
        error: error instanceof Error ? error.message : String(error),
      })
      setErrorMessage(
        userFacingMessage(
          error,
          `Failed to create avatar (max ${MAX_AVATARS} on Basic plan).`,
        ),
      )
      setIsSubmitting(false)
    }
  }

  return (
    <ProjectTypeStep
      selectedType={selectedType}
      onSelect={(type) => {
        setSelectedType(type)
        setFieldError(null)
      }}
      onContinue={() => void handleContinue()}
      isSubmitting={isSubmitting}
      errorMessage={errorMessage}
      fieldError={fieldError}
      backControl={
        <Link
          to="/welcome"
          onClick={() => void advanceOnboardingStep('welcome')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-900"
        >
          ← Back to ContOS Overview
        </Link>
      }
    />
  )
}

export function OnboardingProjectTypePage() {
  return (
    <OnboardingStepGuard expectedStep="project_type">
      <OnboardingProjectTypeContent />
    </OnboardingStepGuard>
  )
}
