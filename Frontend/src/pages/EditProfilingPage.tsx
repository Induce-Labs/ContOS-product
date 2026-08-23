import type { KeyboardEvent } from 'react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AuthAlert, PrimaryButton } from '../components/auth/AuthButtons'
import { fetchAvatar } from '../lib/avatars'
import {
  fetchProfilingQuestions,
  profilingDataToAnswers,
  upsertProfilingAnswer,
  type ProfilingQuestion,
} from '../lib/profiling'
import type { Project } from '../lib/projects'
import type { ProjectType } from '../types/contos'

export function EditProfilingPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [avatar, setAvatar] = useState<Project | null>(null)
  const [questions, setQuestions] = useState<ProfilingQuestion[]>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    let mounted = true

    async function load() {
      if (!projectId) {
        setLoadError('Missing avatar id.')
        setIsLoading(false)
        return
      }

      setIsLoading(true)
      setLoadError(null)

      try {
        const loaded = await fetchAvatar(projectId)
        const type = loaded.type as ProjectType
        const [qs] = await Promise.all([fetchProfilingQuestions(type)])

        if (!mounted) {
          return
        }

        setAvatar(loaded)
        setQuestions(qs)
        setAnswers(profilingDataToAnswers(loaded.profiling_data, qs))
        setQuestionIndex(0)
      } catch (error) {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : 'Failed to load profiling.')
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    void load()
    return () => {
      mounted = false
    }
  }, [projectId])

  async function saveCurrent(): Promise<boolean> {
    if (!avatar || questions.length === 0) {
      return false
    }
    const current = questions[questionIndex]
    const text = (answers[current.question_key] ?? '').trim()
    if (!text) {
      setSaveError('Please answer this question before continuing.')
      return false
    }

    setIsSaving(true)
    setSaveError(null)
    try {
      const updated = await upsertProfilingAnswer(avatar.id, current.question_key, text)
      setAvatar(updated)
      return true
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save answer.')
      return false
    } finally {
      setIsSaving(false)
    }
  }

  async function handleNext() {
    const ok = await saveCurrent()
    if (!ok) {
      return
    }
    if (questionIndex < questions.length - 1) {
      setQuestionIndex((index) => index + 1)
      return
    }
    navigate(`/dashboard/${avatar!.id}`)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void handleNext()
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-ink-muted">
        Loading profiling…
      </div>
    )
  }

  if (loadError || !avatar || !projectId) {
    return (
      <div className="min-h-screen bg-canvas px-6 py-10">
        <p className="text-sm text-red-700">{loadError ?? 'Avatar unavailable.'}</p>
        <Link to="/dashboard" className="mt-4 inline-block text-sm text-accent-primary">
          Back to dashboard
        </Link>
      </div>
    )
  }

  const current = questions[questionIndex]

  return (
    <div className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-accent-primary">ContOS</p>
            <h1 className="text-2xl font-semibold text-ink">Edit profiling</h1>
            <p className="mt-1 text-sm text-ink-muted">{avatar.name}</p>
          </div>
          <Link
            to={`/dashboard/${projectId}`}
            className="text-sm font-medium text-ink-muted hover:text-accent-primary"
          >
            Done
          </Link>
        </div>

        <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-8">
          {saveError ? (
            <div className="mb-6">
              <AuthAlert message={saveError} />
            </div>
          ) : null}

          {!current ? (
            <p className="text-sm text-ink-muted">No active profiling questions for this avatar.</p>
          ) : (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-accent-primary">
                  Step {String(questionIndex + 1).padStart(2, '0')} — Foundations
                </p>
                <p className="mt-1 text-sm text-ink-muted">
                  Completeness: {avatar.profiling_completeness}%
                </p>
                <h2 className="mt-4 text-2xl font-semibold leading-snug text-ink">
                  {current.question}
                </h2>
              </div>

              <textarea
                value={answers[current.question_key] ?? ''}
                onChange={(event) =>
                  setAnswers((prev) => ({ ...prev, [current.question_key]: event.target.value }))
                }
                onKeyDown={handleKeyDown}
                rows={5}
                className="w-full rounded-2xl border border-border-hairline bg-canvas px-4 py-3 text-sm text-ink outline-none focus:border-accent-primary"
              />

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                <button
                  type="button"
                  disabled={isSaving || questionIndex === 0}
                  onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))}
                  className="rounded-xl border border-border-hairline px-4 py-3 text-sm font-medium text-ink transition hover:bg-accent-primary-soft disabled:opacity-60"
                >
                  Back
                </button>
                <PrimaryButton
                  type="button"
                  disabled={isSaving}
                  onClick={() => void handleNext()}
                >
                  {isSaving
                    ? 'Saving…'
                    : questionIndex < questions.length - 1
                      ? 'Next →'
                      : 'Save and return'}
                </PrimaryButton>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
