import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProfilingQuestionDef } from '../config/onboardingProfilingQuestions'
import { fetchAvatar, type Avatar } from '../lib/avatars'
import {
  fetchProfilingQuestionnaire,
  normalizeAnswerForSave,
  profilingDataToAnswers,
  upsertProfilingAnswer,
  validateProfilingAnswer,
} from '../lib/profiling'
import { summarizeProfiling } from '../lib/profileSummary'
import type { ProjectType } from '../types/contos'

export type UseProfilingReviewOptions = {
  avatarId: string | null
}

function answersEqual(a: Record<string, string>, b: Record<string, string>, keys: string[]): boolean {
  return keys.every((key) => (a[key] ?? '') === (b[key] ?? ''))
}

export function useProfilingReview({ avatarId }: UseProfilingReviewOptions) {
  const [avatar, setAvatar] = useState<Avatar | null>(null)
  const [questions, setQuestions] = useState<ProfilingQuestionDef[]>([])
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string>>({})
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({})
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set())
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSummarizing, setIsSummarizing] = useState(false)

  const hasChanges = dirtyKeys.size > 0

  useEffect(() => {
    let isMounted = true

    async function load() {
      if (!avatarId) {
        if (isMounted) {
          setIsLoading(false)
          setErrorMessage('Project is missing. Return to the dashboard and try again.')
        }
        return
      }

      setIsLoading(true)
      setErrorMessage(null)

      try {
        const loaded = await fetchAvatar(avatarId)
        const questionnaire = await fetchProfilingQuestionnaire(loaded.type as ProjectType)
        const hydrated = profilingDataToAnswers(loaded.profiling_data, questionnaire)

        if (!isMounted) {
          return
        }

        setAvatar(loaded)
        setQuestions(questionnaire)
        setSavedAnswers(hydrated)
        setDraftAnswers(hydrated)
        setDirtyKeys(new Set())
        setFieldErrors({})
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error ? error.message : 'Failed to load profiling answers.',
          )
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      isMounted = false
    }
  }, [avatarId])

  const updateDraft = useCallback(
    (key: string, value: string) => {
      setDraftAnswers((current) => {
        const next = { ...current, [key]: value }
        setDirtyKeys((dirty) => {
          const updated = new Set(dirty)
          if ((savedAnswers[key] ?? '') === value) {
            updated.delete(key)
          } else {
            updated.add(key)
          }
          return updated
        })
        return next
      })
      setFieldErrors((current) => {
        if (!(key in current)) {
          return current
        }
        const { [key]: _removed, ...rest } = current
        return rest
      })
      setErrorMessage(null)
    },
    [savedAnswers],
  )

  const sections = useMemo(() => {
    const grouped = new Map<string, ProfilingQuestionDef[]>()
    for (const question of questions) {
      const label = question.sectionLabel || 'FOUNDATIONS'
      const existing = grouped.get(label) ?? []
      existing.push(question)
      grouped.set(label, existing)
    }
    return Array.from(grouped.entries())
  }, [questions])

  async function saveChanges(): Promise<boolean> {
    if (!avatar || !avatarId || !hasChanges || isSaving || isSummarizing) {
      return false
    }

    const keysToSave = Array.from(dirtyKeys)
    const nextFieldErrors: Record<string, string> = {}

    for (const key of keysToSave) {
      const question = questions.find((entry) => entry.key === key)
      if (!question) {
        continue
      }
      const raw = draftAnswers[key] ?? ''
      const validationError = validateProfilingAnswer(question, raw)
      if (validationError) {
        nextFieldErrors[key] = validationError
      }
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors)
      setErrorMessage('Fix the highlighted answers before saving.')
      return false
    }

    setFieldErrors({})
    setErrorMessage(null)
    setIsSaving(true)

    let updatedAvatar = avatar
    const nextSavedAnswers = { ...savedAnswers }

    try {
      for (const key of keysToSave) {
        const question = questions.find((entry) => entry.key === key)
        if (!question) {
          continue
        }
        const raw = draftAnswers[key] ?? ''
        const normalized = normalizeAnswerForSave(question, raw)
        updatedAvatar = await upsertProfilingAnswer(avatarId, key, normalized, {
          optional: !question.required,
          questionText: question.question,
        })
        nextSavedAnswers[key] = normalized
      }

      setAvatar(updatedAvatar)
      setSavedAnswers(nextSavedAnswers)
      setDraftAnswers(nextSavedAnswers)
      setDirtyKeys(new Set())

      setIsSummarizing(true)
      try {
        await summarizeProfiling(avatarId)
      } catch (error) {
        console.error('Profile summary generation failed:', error)
        setErrorMessage(
          error instanceof Error
            ? `Answers saved, but profile summary could not be updated: ${error.message}`
            : 'Answers saved, but profile summary could not be updated.',
        )
      } finally {
        setIsSummarizing(false)
      }

      return true
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save profiling answers.')
      if (!answersEqual(draftAnswers, savedAnswers, keysToSave)) {
        setDraftAnswers((current) => ({ ...current, ...nextSavedAnswers }))
      }
      return false
    } finally {
      setIsSaving(false)
    }
  }

  return {
    avatar,
    questions,
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
    setErrorMessage,
  }
}
