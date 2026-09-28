import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ProjectTypeStep } from '../components/project-setup/ProjectTypeStep'
import { CompetitorsStep } from '../components/project-setup/CompetitorsStep'
import {
  ProfilingStep,
  ProfilingStepLoading,
  ProfilingStepUnavailable,
} from '../components/project-setup/ProfilingStep'
import { useCompetitorIntake } from '../hooks/useCompetitorIntake'
import { useProfilingQuestionnaire } from '../hooks/useProfilingQuestionnaire'
import {
  MAX_AVATARS,
  createAvatar,
  defaultAvatarNameForType,
  type Avatar,
} from '../lib/avatars'
import { setLastUsedProjectId } from '../lib/projects'
import type { ProjectType } from '../types/contos'

type WizardStep = 'type' | 'profiling' | 'competitors'

function NewProjectProfiling({
  avatarId,
  onBackToType,
  onFinished,
}: {
  avatarId: string
  onBackToType: () => void
  onFinished: () => void
}) {
  const navigate = useNavigate()
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const {
    avatar,
    questions,
    questionIndex,
    answers,
    errorMessage,
    translationError,
    fieldError,
    isLoading,
    isSaving,
    isSummarizing,
    isTranslatingQuestions,
    isLocalizingAnswers,
    setAnswer,
    goNext,
    goBack,
    saveDraftCurrentAnswer,
  } = useProfilingQuestionnaire({ avatarId, startAtBeginning: true })

  async function handleNext(answerOverride?: string) {
    const result = await goNext(answerOverride)
    if (result === 'finished') {
      onFinished()
    }
  }

  function handleBack() {
    const result = goBack()
    if (result === 'exit') {
      onBackToType()
    }
  }

  async function handleSaveDraft() {
    setIsSavingDraft(true)
    try {
      const result = await saveDraftCurrentAnswer()
      if (result === 'blocked') {
        return
      }
      navigate(`/dashboard/${avatarId}`, { replace: true })
    } finally {
      setIsSavingDraft(false)
    }
  }

  if (isLoading) {
    return <ProfilingStepLoading />
  }

  if (!avatar || questions.length === 0) {
    return (
      <ProfilingStepUnavailable
        message={errorMessage ?? 'Profiling questions are unavailable.'}
      />
    )
  }

  return (
    <ProfilingStep
      workspaceLabel={avatar.type}
      questions={questions}
      questionIndex={questionIndex}
      answers={answers}
      errorMessage={errorMessage}
      translationError={translationError}
      fieldError={fieldError}
      isSaving={isSaving}
      isSummarizing={isSummarizing}
      isTranslating={isTranslatingQuestions || isLocalizingAnswers}
      isSavingDraft={isSavingDraft}
      showSaveDraft
      onAnswerChange={setAnswer}
      onNext={(answerOverride) => void handleNext(answerOverride)}
      onBack={handleBack}
      onSaveDraft={() => void handleSaveDraft()}
    />
  )
}

export function NewProjectPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<WizardStep>('type')
  const [selectedType, setSelectedType] = useState<ProjectType | null>(null)
  const [avatar, setAvatar] = useState<Avatar | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCreatingAvatar, setIsCreatingAvatar] = useState(false)

  const {
    competitorInputs,
    fieldErrors: competitorFieldErrors,
    errorMessage: competitorErrorMessage,
    isSubmitting,
    updateCompetitorInput,
    updateCompetitorPlatform,
    addCompetitorField,
    removeCompetitorField,
    submitCompetitors,
    minCompetitors,
    maxCompetitors,
  } = useCompetitorIntake()

  async function handleTypeContinue() {
    setErrorMessage(null)

    if (!selectedType) {
      setFieldError('Select a workspace type to continue.')
      return
    }

    setFieldError(null)
    setIsCreatingAvatar(true)

    try {
      const created = await createAvatar(
        defaultAvatarNameForType(selectedType),
        selectedType,
      )
      setLastUsedProjectId(created.id)
      setAvatar(created)
      setStep('profiling')
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : `Failed to create avatar (max ${MAX_AVATARS} on Basic plan).`,
      )
    } finally {
      setIsCreatingAvatar(false)
    }
  }

  async function handleCompetitorsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!avatar) {
      return
    }

    const success = await submitCompetitors(avatar.id)

    if (!success) {
      return
    }

    navigate(`/dashboard/${avatar.id}`, { replace: true })
  }

  if (step === 'type') {
    return (
      <ProjectTypeStep
        selectedType={selectedType}
        onSelect={(type) => {
          setSelectedType(type)
          setFieldError(null)
        }}
        onContinue={() => void handleTypeContinue()}
        isSubmitting={isCreatingAvatar}
        errorMessage={errorMessage}
        fieldError={fieldError}
        stepLabel="New Project"
        backControl={
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted transition-colors hover:text-ink"
          >
            ← Cancel
          </Link>
        }
      />
    )
  }

  if (step === 'profiling') {
    if (!avatar) {
      return (
        <ProfilingStepUnavailable message="Avatar is missing. Return to project type selection." />
      )
    }

    return (
      <NewProjectProfiling
        avatarId={avatar.id}
        onBackToType={() => setStep('type')}
        onFinished={() => setStep('competitors')}
      />
    )
  }

  return (
    <CompetitorsStep
      competitorInputs={competitorInputs}
      fieldErrors={competitorFieldErrors}
      errorMessage={competitorErrorMessage}
      isSubmitting={isSubmitting}
      minCompetitors={minCompetitors}
      maxCompetitors={maxCompetitors}
      onUpdateInput={updateCompetitorInput}
      onUpdatePlatform={updateCompetitorPlatform}
      onAddField={addCompetitorField}
      onRemoveField={removeCompetitorField}
      onSubmit={(event) => void handleCompetitorsSubmit(event)}
      onBack={() => setStep('profiling')}
    />
  )
}
