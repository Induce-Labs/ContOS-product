import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { DashboardLayout } from '../components/dashboard/DashboardLayout'
import { ProfilingReviewPanel } from '../components/dashboard/ProfilingReviewPanel'
import {
  ProfilingStep,
  ProfilingStepLoading,
  ProfilingStepUnavailable,
} from '../components/project-setup/ProfilingStep'
import { useDashboardShell } from '../hooks/useDashboardShell'
import { useProfilingQuestionnaire } from '../hooks/useProfilingQuestionnaire'
import { useProfilingReview } from '../hooks/useProfilingReview'
import { fetchAvatar } from '../lib/avatars'
import { isRequiredProfilingComplete } from '../lib/profiling'

type ProfilingViewMode = 'loading' | 'wizard' | 'review'

function EditProfilingWizard({
  avatarId,
  onCompleted,
}: {
  avatarId: string
  onCompleted: () => void
}) {
  const {
    avatar,
    questions,
    questionIndex,
    answers,
    errorMessage,
    fieldError,
    isLoading,
    isSaving,
    isSummarizing,
    setAnswer,
    goNext,
    goBack,
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
      fieldError={fieldError}
      isSaving={isSaving}
      isSummarizing={isSummarizing}
      onAnswerChange={setAnswer}
      onNext={(answerOverride) => void handleNext(answerOverride)}
      onBack={handleBack}
    />
  )
}

function EditProfilingReview({ avatarId }: { avatarId: string }) {
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
    isLoading,
    isSaving,
    isSummarizing,
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
      mainClassName="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 sm:px-8"
    >
      {projectsError ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {projectsError}
        </div>
      ) : null}

      {!avatar ? (
        <ProfilingStepUnavailable
          message={errorMessage ?? 'Profiling answers are unavailable.'}
        />
      ) : (
        <ProfilingReviewPanel
          workspaceLabel={avatar.type}
          sections={sections}
          draftAnswers={draftAnswers}
          fieldErrors={fieldErrors}
          errorMessage={errorMessage}
          hasChanges={hasChanges}
          isSaving={isSaving}
          isSummarizing={isSummarizing}
          onDraftChange={updateDraft}
          onSave={() => void saveChanges()}
        />
      )}
    </DashboardLayout>
  )
}

export function EditProfilingPage() {
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
        setViewMode(
          isRequiredProfilingComplete(avatar.profiling_completeness) ? 'review' : 'wizard',
        )
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
    return (
      <ProfilingStepUnavailable message="Project is missing. Return to the dashboard and try again." />
    )
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

  return <EditProfilingReview avatarId={projectId} />
}
