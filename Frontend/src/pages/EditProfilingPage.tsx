import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { ProfilingReviewPanel } from '../components/dashboard/ProfilingReviewPanel'
import {
  CompetitorsStep,
} from '../components/project-setup/CompetitorsStep'
import {
  ProfilingStep,
  ProfilingStepLoading,
  ProfilingStepUnavailable,
} from '../components/project-setup/ProfilingStep'
import { useCompetitorIntake } from '../hooks/useCompetitorIntake'
import { useDashboardShell } from '../hooks/useDashboardShell'
import { useProfilingQuestionnaire } from '../hooks/useProfilingQuestionnaire'
import { useProfilingReview } from '../hooks/useProfilingReview'
import { fetchAvatar } from '../lib/avatars'
import { fetchCompetitorsForProject } from '../lib/competitors'
import { isRequiredProfilingComplete } from '../lib/profiling'

type ProfilingViewMode = 'loading' | 'wizard' | 'competitors' | 'review'

function EditProfilingWizard({
  avatarId,
  onCompleted,
}: {
  avatarId: string
  onCompleted: () => void
}) {
  const { t } = useTranslation()
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
  } = useProfilingQuestionnaire({ avatarId })

  async function handleNext(answerOverride?: string) {
    const result = await goNext(answerOverride)
    if (result === 'finished') {
      onCompleted()
    }
  }

  function handleBack() {
    goBack()
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
        message={errorMessage ?? t('profiling.questionsUnavailable')}
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

function EditProfilingCompetitors({ avatarId }: { avatarId: string }) {
  const navigate = useNavigate()
  const {
    competitorInputs,
    fieldErrors,
    errorMessage,
    isSubmitting,
    updateCompetitorInput,
    updateCompetitorPlatform,
    addCompetitorField,
    removeCompetitorField,
    submitCompetitors,
    minCompetitors,
    maxCompetitors,
  } = useCompetitorIntake()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const success = await submitCompetitors(avatarId)
    if (!success) {
      return
    }

    navigate(`/dashboard/${avatarId}`, { replace: true })
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
      onBack={() => navigate(`/dashboard/${avatarId}`, { replace: true })}
    />
  )
}

function EditProfilingReview({ avatarId }: { avatarId: string }) {
  const { t } = useTranslation()
  const {
    user,
    projects,
    setProjects,
    activeProject,
    projectsLoading,
    projectsError,
    isSigningOut,
    sidebarOpen,
    setSidebarOpen,
    handleSignOut,
  } = useDashboardShell()

  const {
    avatar,
    sections,
    draftAnswers,
    fieldErrors,
    errorMessage,
    translationError,
    isLoading,
    isSaving,
    isSummarizing,
    isTranslatingQuestions,
    isLocalizingAnswers,
    hasChanges,
    updateDraft,
    saveChanges,
  } = useProfilingReview({ avatarId })

  return (
    <DashboardLayout
      projects={projects}
      activeProject={activeProject}
      onAvatarsChanged={setProjects}
      userEmail={user?.email}
      isSigningOut={isSigningOut}
      onSignOut={() => void handleSignOut()}
      sidebarOpen={sidebarOpen}
      onSidebarOpenChange={setSidebarOpen}
      isLoading={projectsLoading || isLoading}
      mainClassName="flex min-h-0 flex-1 flex-col overflow-hidden bg-white px-4 pb-4 pt-6 sm:px-8 sm:pt-8 dark:bg-canvas"
    >
      {projectsError ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {projectsError}
        </div>
      ) : null}

      {!avatar ? (
        <ProfilingStepUnavailable
          message={errorMessage ?? t('profiling.answersUnavailable')}
        />
      ) : (
        <ProfilingReviewPanel
          avatarId={avatarId}
          workspaceLabel={avatar.type}
          sections={sections}
          draftAnswers={draftAnswers}
          fieldErrors={fieldErrors}
          errorMessage={errorMessage}
          translationError={translationError}
          hasChanges={hasChanges}
          isSaving={isSaving}
          isSummarizing={isSummarizing}
          isTranslating={isTranslatingQuestions || isLocalizingAnswers}
          onDraftChange={updateDraft}
          onSave={() => void saveChanges()}
        />
      )}
    </DashboardLayout>
  )
}

export function EditProfilingPage() {
  const { t } = useTranslation()
  const { projectId } = useParams()
  const [viewMode, setViewMode] = useState<ProfilingViewMode>('loading')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let isMounted = true

    async function resolveViewMode() {
      if (!projectId) {
        if (isMounted) {
          setViewMode('loading')
        }
        return
      }

      setViewMode('loading')

      try {
        const avatar = await fetchAvatar(projectId)
        if (!isMounted) {
          return
        }

        if (!isRequiredProfilingComplete(avatar.profiling_completeness)) {
          setViewMode('wizard')
          return
        }

        const competitors = await fetchCompetitorsForProject(projectId)
        if (!isMounted) {
          return
        }

        setViewMode(competitors.length === 0 ? 'competitors' : 'review')
      } catch {
        if (isMounted) {
          setViewMode('wizard')
        }
      }
    }

    void resolveViewMode()

    return () => {
      isMounted = false
    }
  }, [projectId, reloadToken])

  if (!projectId) {
    return <ProfilingStepUnavailable message={t('profiling.projectMissing')} />
  }

  if (viewMode === 'loading') {
    return <ProfilingStepLoading />
  }

  if (viewMode === 'wizard') {
    return (
      <EditProfilingWizard
        avatarId={projectId}
        onCompleted={() => setReloadToken((token) => token + 1)}
      />
    )
  }

  if (viewMode === 'competitors') {
    return <EditProfilingCompetitors avatarId={projectId} />
  }

  return <EditProfilingReview avatarId={projectId} />
}
