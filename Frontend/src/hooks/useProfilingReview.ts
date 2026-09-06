import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProfilingQuestionDef } from '../config/onboardingProfilingQuestions'
import { useLocalizedQuestionnaire } from './useLocalizedQuestionnaire'
import { fetchAvatar, type Avatar } from '../lib/avatars'
import {
  fetchProfilingQuestionnaire,
  normalizeAnswerForSave,
  profilingDataToAnswers,
  upsertProfilingAnswer,
  validateProfilingAnswer,
} from '../lib/profiling'
import {
  answersToEnglishForSave,
  answersToLocaleForDisplay,
  resolveUiLanguage,
} from '../lib/profilingLocale'
import { summarizeProfiling } from '../lib/profileSummary'
import type { ProjectType } from '../types/contos'

export type UseProfilingReviewOptions = {
  avatarId: string | null
}

function answersEqual(
  a: Record<string, string>,
  b: Record<string, string>,
  keys: string[],
): boolean {
  return keys.every((key) => (a[key] ?? '') === (b[key] ?? ''))
}

export function useProfilingReview({ avatarId }: UseProfilingReviewOptions) {
  const { i18n, t } = useTranslation()
  const locale = resolveUiLanguage(i18n.language)

  const [avatar, setAvatar] = useState<Avatar | null>(null)
  const [canonicalQuestions, setCanonicalQuestions] = useState<ProfilingQuestionDef[]>(
    [],
  )
  const englishSavedRef = useRef<Record<string, string>>({})
  const [savedAnswers, setSavedAnswers] = useState<Record<string, string>>({})
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({})
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set())
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isSummarizing, setIsSummarizing] = useState(false)
  const [isLocalizingAnswers, setIsLocalizingAnswers] = useState(false)

  const {
    displayQuestions,
    optionMaps,
    isTranslating: isTranslatingQuestions,
    translationError: questionTranslationError,
  } = useLocalizedQuestionnaire(canonicalQuestions)

  const questions =
    displayQuestions.length > 0 ? displayQuestions : canonicalQuestions

  const hasChanges = dirtyKeys.size > 0

  useEffect(() => {
    let isMounted = true

    async function load() {
      if (!avatarId) {
        if (isMounted) {
          setIsLoading(false)
          setErrorMessage(t('profiling.projectMissing'))
        }
        return
      }

      setIsLoading(true)
      setErrorMessage(null)

      try {
        const loaded = await fetchAvatar(avatarId)
        const questionnaire = await fetchProfilingQuestionnaire(
          loaded.type as ProjectType,
        )
        const hydrated = profilingDataToAnswers(loaded.profiling_data, questionnaire)

        if (!isMounted) {
          return
        }

        setAvatar(loaded)
        setCanonicalQuestions(questionnaire)
        englishSavedRef.current = hydrated
        setSavedAnswers(hydrated)
        setDraftAnswers(hydrated)
        setDirtyKeys(new Set())
        setFieldErrors({})
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : t('profiling.errors.loadAnswers'),
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
  }, [avatarId, t])

  useEffect(() => {
    let cancelled = false
    const english = englishSavedRef.current
    if (Object.keys(english).length === 0 || canonicalQuestions.length === 0) {
      return
    }
    if (dirtyKeys.size > 0) {
      // Don't clobber in-progress edits when language changes mid-edit.
      return
    }
    if (locale === 'en') {
      setSavedAnswers({ ...english })
      setDraftAnswers({ ...english })
      setIsLocalizingAnswers(false)
      return
    }
    if (isTranslatingQuestions) {
      return
    }

    setIsLocalizingAnswers(true)
    void (async () => {
      try {
        const localized = await answersToLocaleForDisplay({
          englishAnswers: english,
          canonicalQuestions,
          optionMaps,
          targetLang: locale,
        })
        if (!cancelled) {
          setSavedAnswers(localized)
          setDraftAnswers(localized)
        }
      } catch (error) {
        if (!cancelled) {
          setSavedAnswers({ ...english })
          setDraftAnswers({ ...english })
          setErrorMessage(
            error instanceof Error ? error.message : t('agents.translationFailed'),
          )
        }
      } finally {
        if (!cancelled) {
          setIsLocalizingAnswers(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    locale,
    canonicalQuestions,
    optionMaps,
    isTranslatingQuestions,
    dirtyKeys.size,
    t,
  ])

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
      const label = question.sectionLabel || t('profiling.defaultSection')
      const existing = grouped.get(label) ?? []
      existing.push(question)
      grouped.set(label, existing)
    }
    return Array.from(grouped.entries())
  }, [questions, t])

  async function saveChanges(): Promise<boolean> {
    if (!avatar || !avatarId || !hasChanges || isSaving || isSummarizing) {
      return false
    }

    const keysToSave = Array.from(dirtyKeys)
    setFieldErrors({})
    setErrorMessage(null)
    setIsSaving(true)

    let updatedAvatar = avatar
    const nextEnglishSaved = { ...englishSavedRef.current }

    try {
      const englishBatch = await answersToEnglishForSave({
        answers: draftAnswers,
        keys: keysToSave,
        canonicalQuestions,
        optionMaps,
        sourceLang: locale,
      })

      const nextFieldErrors: Record<string, string> = {}
      for (const key of keysToSave) {
        const question = canonicalQuestions.find((entry) => entry.key === key)
        if (!question) continue
        const englishRaw = englishBatch[key] ?? ''
        const validationError = validateProfilingAnswer(question, englishRaw)
        if (validationError) {
          nextFieldErrors[key] = validationError.startsWith('profiling.')
            ? t(validationError)
            : validationError
        }
      }
      if (Object.keys(nextFieldErrors).length > 0) {
        setFieldErrors(nextFieldErrors)
        setErrorMessage(t('profiling.validation.fixBeforeSave'))
        return false
      }

      for (const key of keysToSave) {
        const question = canonicalQuestions.find((entry) => entry.key === key)
        if (!question) continue
        const englishRaw = englishBatch[key] ?? ''
        const normalized = normalizeAnswerForSave(question, englishRaw)
        updatedAvatar = await upsertProfilingAnswer(avatarId, key, normalized, {
          optional: !question.required,
          questionText: question.question,
        })
        nextEnglishSaved[key] = normalized
      }

      englishSavedRef.current = nextEnglishSaved
      setAvatar(updatedAvatar)

      const localizedSaved =
        locale === 'en'
          ? { ...nextEnglishSaved }
          : await answersToLocaleForDisplay({
              englishAnswers: nextEnglishSaved,
              canonicalQuestions,
              optionMaps,
              targetLang: locale,
            })

      setSavedAnswers(localizedSaved)
      setDraftAnswers(localizedSaved)
      setDirtyKeys(new Set())

      setIsSummarizing(true)
      try {
        await summarizeProfiling(avatarId)
      } catch (error) {
        console.error('Profile summary generation failed:', error)
        setErrorMessage(
          error instanceof Error
            ? t('profiling.errors.summaryAfterReviewSaveWithDetail', {
                detail: error.message,
              })
            : t('profiling.errors.summaryAfterReviewSave'),
        )
      } finally {
        setIsSummarizing(false)
      }

      return true
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t('profiling.errors.saveAnswers'),
      )
      if (!answersEqual(draftAnswers, savedAnswers, keysToSave)) {
        setDraftAnswers((current) => ({ ...current }))
      }
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const combinedError =
    errorMessage ??
    (questionTranslationError ? t('agents.translationFailed') : null)

  return {
    avatar,
    questions,
    sections,
    draftAnswers,
    fieldErrors,
    errorMessage: combinedError,
    isLoading: isLoading || isLocalizingAnswers,
    isSaving,
    isSummarizing,
    isTranslatingQuestions,
    isLocalizingAnswers,
    hasChanges,
    updateDraft,
    saveChanges,
    setErrorMessage,
  }
}
