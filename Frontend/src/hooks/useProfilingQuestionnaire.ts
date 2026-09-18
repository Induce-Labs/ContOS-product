import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProfilingQuestionDef } from '../config/onboardingProfilingQuestions'
import { useLocalizedQuestionnaire } from './useLocalizedQuestionnaire'
import { fetchAvatar, type Avatar } from '../lib/avatars'
import {
  fetchProfilingQuestionnaire,
  firstUnansweredQuestionIndex,
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

export type UseProfilingQuestionnaireOptions = {
  avatarId: string | null
  /** When set, use this type instead of loading from avatar (e.g. new project wizard). */
  projectType?: ProjectType | null
  /** Start at question 0 even if answers exist (e.g. edit flow). */
  startAtBeginning?: boolean
}

export function useProfilingQuestionnaire({
  avatarId,
  projectType = null,
  startAtBeginning = false,
}: UseProfilingQuestionnaireOptions) {
  const { i18n, t } = useTranslation()
  const locale = resolveUiLanguage(i18n.language)

  const [avatar, setAvatar] = useState<Avatar | null>(null)
  const [canonicalQuestions, setCanonicalQuestions] = useState<ProfilingQuestionDef[]>(
    [],
  )
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const englishAnswersRef = useRef<Record<string, string>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
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
    isTranslatingQuestions && displayQuestions.length === 0
      ? []
      : displayQuestions.length > 0
        ? displayQuestions
        : canonicalQuestions
  const currentQuestion = questions[questionIndex] ?? null
  const currentCanonical = canonicalQuestions[questionIndex] ?? null

  useEffect(() => {
    let isMounted = true

    async function load() {
      if (!avatarId) {
        if (isMounted) {
          setIsLoading(false)
          setErrorMessage(t('profiling.avatarMissingSetup'))
        }
        return
      }

      setIsLoading(true)
      setErrorMessage(null)

      try {
        const loaded = await fetchAvatar(avatarId)
        const type = (projectType ?? loaded.type) as ProjectType
        const questionnaire = await fetchProfilingQuestionnaire(type)
        const hydrated = profilingDataToAnswers(loaded.profiling_data, questionnaire)
        const resumeIndex = startAtBeginning
          ? 0
          : firstUnansweredQuestionIndex(questionnaire, hydrated)

        if (!isMounted) {
          return
        }

        setAvatar(loaded)
        setCanonicalQuestions(questionnaire)
        englishAnswersRef.current = hydrated
        setAnswers(hydrated)
        setQuestionIndex(resumeIndex)
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : t('profiling.errors.loadQuestionnaire'),
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
  }, [avatarId, projectType, startAtBeginning, t])

  // Re-localize stored English answers when locale or option maps change.
  useEffect(() => {
    let cancelled = false
    const english = englishAnswersRef.current
    if (Object.keys(english).length === 0 || canonicalQuestions.length === 0) {
      return
    }

    if (locale === 'en') {
      setAnswers({ ...english })
      setIsLocalizingAnswers(false)
      return
    }

    // Wait until question option maps are ready (or failed → still map what we can).
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
          setAnswers(localized)
        }
      } catch (error) {
        if (!cancelled) {
          setAnswers({ ...english })
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
    t,
  ])

  const setAnswer = useCallback((key: string, value: string) => {
    setAnswers((current) => ({ ...current, [key]: value }))
    setFieldError(null)
  }, [])

  async function saveCurrentAnswer(answerOverride?: string): Promise<boolean> {
    if (!avatar || !currentCanonical) {
      return false
    }

    const raw = answerOverride ?? answers[currentCanonical.key] ?? ''

    setFieldError(null)
    setIsSaving(true)

    try {
      const englishMapped = await answersToEnglishForSave({
        answers: { [currentCanonical.key]: raw },
        keys: [currentCanonical.key],
        canonicalQuestions,
        optionMaps,
        sourceLang: locale,
      })
      const englishRaw = englishMapped[currentCanonical.key] ?? ''
      const validationError = validateProfilingAnswer(currentCanonical, englishRaw)
      if (validationError) {
        setFieldError(
          validationError.startsWith('profiling.')
            ? t(validationError)
            : validationError,
        )
        return false
      }

      const normalized = normalizeAnswerForSave(currentCanonical, englishRaw)
      const updated = await upsertProfilingAnswer(
        avatar.id,
        currentCanonical.key,
        normalized,
        {
          optional: !currentCanonical.required,
          questionText: currentCanonical.question,
        },
      )
      setAvatar(updated)
      englishAnswersRef.current = {
        ...englishAnswersRef.current,
        [currentCanonical.key]: normalized,
      }
      // Keep UI draft as user typed (locale); English snapshot updated for language switches.
      setAnswers((current) => ({
        ...current,
        [currentCanonical.key]: answerOverride ?? current[currentCanonical.key] ?? raw,
      }))
      return true
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : t('profiling.errors.saveAnswer'),
      )
      return false
    } finally {
      setIsSaving(false)
    }
  }

  async function goNext(
    answerOverride?: string,
  ): Promise<'advanced' | 'finished' | 'blocked'> {
    if (!currentCanonical || isSaving) {
      return 'blocked'
    }

    setErrorMessage(null)
    if (answerOverride !== undefined) {
      setAnswers((current) => ({
        ...current,
        [currentCanonical.key]: answerOverride,
      }))
    }
    const saved = await saveCurrentAnswer(answerOverride)
    if (!saved) {
      return 'blocked'
    }

    if (questionIndex < canonicalQuestions.length - 1) {
      setQuestionIndex((index) => index + 1)
      return 'advanced'
    }

    if (avatarId) {
      setIsSummarizing(true)
      try {
        await summarizeProfiling(avatarId)
      } catch (error) {
        console.error('Profile summary generation failed:', error)
        setErrorMessage(
          error instanceof Error
            ? t('profiling.errors.summaryAfterSaveWithDetail', {
                detail: error.message,
              })
            : t('profiling.errors.summaryAfterSave'),
        )
      } finally {
        setIsSummarizing(false)
      }
    }

    return 'finished'
  }

  function goBack(): 'previous-question' | 'exit' {
    setErrorMessage(null)
    setFieldError(null)

    if (questionIndex > 0) {
      setQuestionIndex((index) => index - 1)
      return 'previous-question'
    }

    return 'exit'
  }

  async function saveDraftCurrentAnswer(): Promise<'saved' | 'skipped' | 'blocked'> {
    if (!currentCanonical || isSaving) {
      return 'blocked'
    }

    const raw = (answers[currentCanonical.key] ?? '').trim()
    if (!raw) {
      setFieldError(null)
      setErrorMessage(null)
      return 'skipped'
    }

    setErrorMessage(null)
    const saved = await saveCurrentAnswer()
    return saved ? 'saved' : 'blocked'
  }

  return {
    avatar,
    questions,
    canonicalQuestions,
    questionIndex,
    answers,
    currentQuestion,
    errorMessage,
    /** Non-null when display questions fell back to English after translate failure. */
    translationError: questionTranslationError,
    fieldError,
    isLoading: isLoading || isLocalizingAnswers || isTranslatingQuestions,
    isSaving,
    isSummarizing,
    isTranslatingQuestions,
    isLocalizingAnswers,
    setAnswer,
    goNext,
    goBack,
    saveDraftCurrentAnswer,
    setErrorMessage,
  }
}
