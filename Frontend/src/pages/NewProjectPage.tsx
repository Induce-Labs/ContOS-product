import type { FormEvent, KeyboardEvent } from 'react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthAlert, PrimaryButton } from '../components/auth/AuthButtons'
import { AuthFormField } from '../components/auth/AuthFormField'
import { enqueueCompetitorScrapeJobsOrThrow } from '../lib/api'
import { MAX_AVATARS, createAvatar } from '../lib/avatars'
import {
  MAX_COMPETITORS_PER_AVATAR,
  MIN_COMPETITORS_PER_AVATAR,
  RECOMMENDED_COMPETITORS_PER_AVATAR,
  createCompetitors,
} from '../lib/competitors'
import { normalizeCompetitorInputs, validateInstagramInput } from '../lib/instagram'
import { normalizeLinkedInInputs, validateLinkedInInput } from '../lib/linkedin'
import {
  fetchProfilingQuestions,
  upsertProfilingAnswer,
  type ProfilingQuestion,
} from '../lib/profiling'
import { setLastUsedProjectId, updateProjectStatus, type Project } from '../lib/projects'
import type { CompetitorPlatform, ProjectType } from '../types/contos'

type WizardStep = 'type' | 'name' | 'profiling' | 'competitors'

type CompetitorDraft = {
  value: string
  platform: CompetitorPlatform
}

const AVATAR_TYPE_OPTIONS: Array<{ value: ProjectType; label: string; description: string }> = [
  {
    value: 'personal_branding',
    label: 'Personal Brand',
    description: 'Tailor insights and strategy for your personal brand.',
  },
  {
    value: 'business',
    label: 'Business',
    description: 'Tailor insights and strategy for a company or product.',
  },
]

export function NewProjectPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<WizardStep>('type')
  const [projectName, setProjectName] = useState('')
  const [projectType, setProjectType] = useState<ProjectType | null>(null)
  const [avatar, setAvatar] = useState<Project | null>(null)
  const [questions, setQuestions] = useState<ProfilingQuestion[]>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [competitorInputs, setCompetitorInputs] = useState<CompetitorDraft[]>([
    { value: '', platform: 'instagram' },
  ])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSavingAnswer, setIsSavingAnswer] = useState(false)
  const [isCreatingAvatar, setIsCreatingAvatar] = useState(false)
  const [questionsLoading, setQuestionsLoading] = useState(false)

  useEffect(() => {
    if (!projectType || step !== 'profiling') {
      return
    }

    let mounted = true
    setQuestionsLoading(true)
    void fetchProfilingQuestions(projectType)
      .then((rows) => {
        if (mounted) {
          setQuestions(rows)
          setQuestionIndex(0)
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          setErrorMessage(
            error instanceof Error ? error.message : 'Failed to load profiling questions.',
          )
        }
      })
      .finally(() => {
        if (mounted) {
          setQuestionsLoading(false)
        }
      })

    return () => {
      mounted = false
    }
  }, [projectType, step])

  function handleTypeContinue() {
    setErrorMessage(null)
    if (!projectType) {
      setFieldErrors({ projectType: 'Select Personal Brand or Business to continue.' })
      return
    }
    setFieldErrors({})
    setStep('name')
  }

  async function handleNameContinue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)

    if (!projectType) {
      setErrorMessage('Select an avatar type first.')
      return
    }

    if (!projectName.trim()) {
      setFieldErrors({ projectName: 'Avatar name is required.' })
      return
    }

    setFieldErrors({})
    setIsCreatingAvatar(true)

    try {
      const created = await createAvatar(projectName, projectType)
      setAvatar(created)
      setLastUsedProjectId(created.id)
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

  async function saveCurrentAnswer(): Promise<boolean> {
    if (!avatar || questions.length === 0) {
      return false
    }

    const current = questions[questionIndex]
    const text = (answers[current.question_key] ?? '').trim()
    if (!text) {
      setFieldErrors({ answer: 'Please answer this question before continuing.' })
      return false
    }

    setFieldErrors({})
    setIsSavingAnswer(true)
    try {
      await upsertProfilingAnswer(avatar.id, current.question_key, text)
      return true
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to save profiling answer.',
      )
      return false
    } finally {
      setIsSavingAnswer(false)
    }
  }

  async function handleProfilingNext() {
    setErrorMessage(null)
    const saved = await saveCurrentAnswer()
    if (!saved) {
      return
    }

    if (questionIndex < questions.length - 1) {
      setQuestionIndex((index) => index + 1)
      return
    }

    setStep('competitors')
  }

  function handleProfilingBack() {
    setErrorMessage(null)
    setFieldErrors({})
    if (questionIndex > 0) {
      setQuestionIndex((index) => index - 1)
      return
    }
    setStep('name')
  }

  function handleAnswerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleProfilingNext()
    }
  }

  function updateCompetitorInput(index: number, value: string) {
    setCompetitorInputs((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, value } : entry,
      ),
    )
  }

  function updateCompetitorPlatform(index: number, platform: CompetitorPlatform) {
    setCompetitorInputs((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, platform } : entry,
      ),
    )
  }

  function addCompetitorField() {
    if (competitorInputs.length >= MAX_COMPETITORS_PER_AVATAR) {
      return
    }
    setCompetitorInputs((current) => [...current, { value: '', platform: 'instagram' }])
  }

  function removeCompetitorField(index: number) {
    if (competitorInputs.length <= MIN_COMPETITORS_PER_AVATAR) {
      return
    }
    setCompetitorInputs((current) => current.filter((_, entryIndex) => entryIndex !== index))
  }

  function validateCompetitorFields(): Array<{
    platform: CompetitorPlatform
    urls: string[]
  }> | null {
    const filled = competitorInputs.filter((entry) => entry.value.trim())

    if (filled.length < MIN_COMPETITORS_PER_AVATAR) {
      setErrorMessage(`Add at least ${MIN_COMPETITORS_PER_AVATAR} competitor.`)
      return null
    }

    if (filled.length > MAX_COMPETITORS_PER_AVATAR) {
      setErrorMessage(`You can add up to ${MAX_COMPETITORS_PER_AVATAR} competitors per avatar.`)
      return null
    }

    const errors: Record<string, string> = {}

    competitorInputs.forEach((entry, index) => {
      const trimmed = entry.value.trim()
      if (!trimmed) {
        return
      }

      if (entry.platform === 'linkedin') {
        const result = validateLinkedInInput(trimmed)
        if (!result.valid) {
          errors[`competitor-${index}`] = result.message
        }
      } else {
        const result = validateInstagramInput(trimmed)
        if (!result.valid) {
          errors[`competitor-${index}`] = result.message
        }
      }
    })

    setFieldErrors(errors)

    if (Object.keys(errors).length > 0) {
      setErrorMessage('Fix the highlighted competitor entries before continuing.')
      return null
    }

    try {
      const byPlatform = new Map<CompetitorPlatform, string[]>()

      for (const entry of filled) {
        const platform = entry.platform === 'linkedin' ? 'linkedin' : 'instagram'
        const existing = byPlatform.get(platform) ?? []
        existing.push(entry.value.trim())
        byPlatform.set(platform, existing)
      }

      const groups: Array<{ platform: CompetitorPlatform; urls: string[] }> = []

      for (const [platform, values] of byPlatform) {
        const normalized =
          platform === 'linkedin'
            ? normalizeLinkedInInputs(values)
            : normalizeCompetitorInputs(values)
        groups.push({ platform, urls: normalized })
      }

      return groups
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Competitor validation failed unexpectedly.',
      )
      return null
    }
  }

  async function handleCompetitorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)

    if (!avatar) {
      setErrorMessage('Avatar is missing. Go back and create one first.')
      return
    }

    const groups = validateCompetitorFields()
    if (!groups) {
      return
    }

    setIsSubmitting(true)

    try {
      const createdIds: string[] = []

      for (const group of groups) {
        const competitors = await createCompetitors(avatar.id, group.urls, group.platform)
        createdIds.push(...competitors.map((competitor) => competitor.id))
      }

      await updateProjectStatus(avatar.id, 'scraping')
      await enqueueCompetitorScrapeJobsOrThrow(avatar.id, createdIds)

      setLastUsedProjectId(avatar.id)
      navigate(`/dashboard/${avatar.id}`, { replace: true })
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to start competitor research.',
      )
      setIsSubmitting(false)
    }
  }

  const currentQuestion = questions[questionIndex] ?? null
  const stepOrder: WizardStep[] = ['type', 'name', 'profiling', 'competitors']

  return (
    <div className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-accent-primary">ContOS</p>
            <h1 className="text-2xl font-semibold text-ink">Start a New Project</h1>
          </div>
          <Link
            to="/dashboard"
            className="text-sm font-medium text-ink-muted hover:text-accent-primary"
          >
            Cancel
          </Link>
        </div>

        <div className="mb-8 flex flex-wrap items-center gap-2 text-sm">
          {stepOrder.map((entry, index) => (
            <div key={entry} className="flex items-center gap-2">
              <StepBadge
                active={step === entry}
                complete={stepOrder.indexOf(step) > index}
                label={
                  entry === 'type'
                    ? 'Type'
                    : entry === 'name'
                      ? 'Name'
                      : entry === 'profiling'
                        ? 'Profile'
                        : 'Competitors'
                }
              />
              {index < stepOrder.length - 1 ? (
                <div className="hidden h-px w-6 bg-border-hairline sm:block" />
              ) : null}
            </div>
          ))}
        </div>

        <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8">
          {errorMessage ? (
            <div className="mb-6">
              <AuthAlert message={errorMessage} />
            </div>
          ) : null}

          {step === 'type' ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-ink">Select the primary focus</h2>
                <p className="mt-2 text-sm text-ink-muted">
                  Choose the workspace type to tailor insights and strategy for this avatar.
                </p>
              </div>

              <div className="grid gap-3">
                {AVATAR_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setProjectType(option.value)
                      setFieldErrors({})
                    }}
                    className={`rounded-2xl border px-5 py-5 text-left transition ${
                      projectType === option.value
                        ? 'border-accent-primary bg-accent-primary-soft'
                        : 'border-border-hairline hover:border-accent-primary/40'
                    }`}
                  >
                    <span className="block text-base font-semibold text-ink">{option.label}</span>
                    <span className="mt-1 block text-sm text-ink-muted">{option.description}</span>
                  </button>
                ))}
              </div>
              {fieldErrors.projectType ? (
                <p className="text-sm text-red-600">{fieldErrors.projectType}</p>
              ) : null}

              <PrimaryButton type="button" onClick={handleTypeContinue}>
                Continue
              </PrimaryButton>
            </div>
          ) : null}

          {step === 'name' ? (
            <form className="space-y-6" onSubmit={(event) => void handleNameContinue(event)}>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-accent-primary">
                  {projectType === 'business' ? 'Business' : 'Personal Brand'}
                </p>
                <h2 className="mt-1 text-xl font-semibold text-ink">Name your avatar</h2>
                <p className="mt-2 text-sm text-ink-muted">
                  Examples: Personal Brand, Induce Labs, Client — XYZ
                </p>
              </div>

              <AuthFormField
                label="Avatar name"
                name="projectName"
                placeholder="e.g. Induce Labs"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                error={fieldErrors.projectName}
                required
              />

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setStep('type')}
                  disabled={isCreatingAvatar}
                  className="rounded-xl border border-border-hairline px-4 py-3 text-sm font-medium text-ink transition hover:bg-accent-primary-soft disabled:opacity-60"
                >
                  Back
                </button>
                <PrimaryButton disabled={isCreatingAvatar}>
                  {isCreatingAvatar ? 'Creating…' : 'Continue to profiling'}
                </PrimaryButton>
              </div>
            </form>
          ) : null}

          {step === 'profiling' ? (
            <div className="space-y-6">
              {questionsLoading || !currentQuestion ? (
                <p className="text-sm text-ink-muted">Loading profiling questions…</p>
              ) : (
                <>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-accent-primary">
                      Step {String(questionIndex + 1).padStart(2, '0')} — Foundations
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      Workspace: {avatar?.name ?? projectName}
                    </p>
                    <h2 className="mt-4 text-2xl font-semibold leading-snug text-ink">
                      {currentQuestion.question}
                    </h2>
                    <p className="mt-2 text-xs text-ink-muted">
                      {questionIndex + 1} of {questions.length} · Press Enter to continue
                    </p>
                  </div>

                  <textarea
                    value={answers[currentQuestion.question_key] ?? ''}
                    onChange={(event) =>
                      setAnswers((current) => ({
                        ...current,
                        [currentQuestion.question_key]: event.target.value,
                      }))
                    }
                    onKeyDown={handleAnswerKeyDown}
                    rows={5}
                    placeholder="We exist to…"
                    className="w-full rounded-2xl border border-border-hairline bg-canvas px-4 py-3 text-sm text-ink outline-none focus:border-accent-primary"
                  />
                  {fieldErrors.answer ? (
                    <p className="text-sm text-red-600">{fieldErrors.answer}</p>
                  ) : null}

                  <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                    <button
                      type="button"
                      onClick={handleProfilingBack}
                      disabled={isSavingAnswer}
                      className="rounded-xl border border-border-hairline px-4 py-3 text-sm font-medium text-ink transition hover:bg-accent-primary-soft disabled:opacity-60"
                    >
                      Back
                    </button>
                    <PrimaryButton
                      type="button"
                      disabled={isSavingAnswer}
                      onClick={() => void handleProfilingNext()}
                    >
                      {isSavingAnswer
                        ? 'Saving…'
                        : questionIndex < questions.length - 1
                          ? 'Next →'
                          : 'Continue to competitors'}
                    </PrimaryButton>
                  </div>
                </>
              )}
            </div>
          ) : null}

          {step === 'competitors' ? (
            <form className="space-y-6" onSubmit={(event) => void handleCompetitorSubmit(event)}>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-ink">Know your competitive landscape</h2>
                <p className="text-sm text-ink-muted">
                  Add competitors to help ContOS understand what is happening in your space.
                  Instagram and LinkedIn profiles. Add {MIN_COMPETITORS_PER_AVATAR}–
                  {MAX_COMPETITORS_PER_AVATAR} (recommend {RECOMMENDED_COMPETITORS_PER_AVATAR}).
                </p>
              </div>

              <div className="space-y-4">
                {competitorInputs.map((entry, index) => (
                  <div key={`competitor-${index}`} className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={entry.platform}
                        onChange={(event) =>
                          updateCompetitorPlatform(
                            index,
                            event.target.value as CompetitorPlatform,
                          )
                        }
                        className="rounded-xl border border-border-hairline bg-canvas px-3 py-2 text-sm text-ink"
                      >
                        <option value="instagram">Instagram</option>
                        <option value="linkedin">LinkedIn</option>
                      </select>
                      {competitorInputs.length > MIN_COMPETITORS_PER_AVATAR ? (
                        <button
                          type="button"
                          onClick={() => removeCompetitorField(index)}
                          className="rounded-xl border border-border-hairline px-3 py-2 text-sm text-ink-muted hover:bg-accent-primary-soft"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <AuthFormField
                      label={`Competitor ${index + 1}`}
                      name={`competitor-${index}`}
                      placeholder={
                        entry.platform === 'linkedin'
                          ? 'linkedin.com/in/competitor or slug'
                          : '@competitor or https://instagram.com/competitor'
                      }
                      value={entry.value}
                      onChange={(event) => updateCompetitorInput(index, event.target.value)}
                      error={fieldErrors[`competitor-${index}`]}
                    />
                  </div>
                ))}
              </div>

              {competitorInputs.length < MAX_COMPETITORS_PER_AVATAR ? (
                <button
                  type="button"
                  onClick={addCompetitorField}
                  className="rounded-xl border border-dashed border-border-hairline px-4 py-3 text-sm font-medium text-accent-primary hover:bg-accent-primary-soft"
                >
                  + Add Competitor
                </button>
              ) : (
                <p className="text-sm text-ink-muted">
                  Maximum of {MAX_COMPETITORS_PER_AVATAR} competitors reached.
                </p>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setStep('profiling')}
                  disabled={isSubmitting}
                  className="rounded-xl border border-border-hairline px-4 py-3 text-sm font-medium text-ink transition hover:bg-accent-primary-soft disabled:opacity-60"
                >
                  Back
                </button>
                <PrimaryButton disabled={isSubmitting}>
                  {isSubmitting ? 'Starting research…' : 'Research Competitors →'}
                </PrimaryButton>
              </div>
            </form>
          ) : null}
        </section>
      </div>
    </div>
  )
}

type StepBadgeProps = {
  label: string
  active: boolean
  complete: boolean
}

function StepBadge({ label, active, complete }: StepBadgeProps) {
  const classes = active
    ? 'bg-accent-primary text-white'
    : complete
      ? 'bg-accent-primary-soft text-accent-primary-deep'
      : 'bg-canvas text-ink-muted border border-border-hairline'

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide ${classes}`}>
      {label}
    </span>
  )
}