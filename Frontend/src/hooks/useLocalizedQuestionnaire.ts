import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProfilingQuestionDef } from '../config/onboardingProfilingQuestions'
import {
  buildLocalizedQuestionnaire,
  collectQuestionnaireDisplayStrings,
  resolveUiLanguage,
  translateTextsChunkedWithRetry,
  type LocalizedQuestionnaire,
  type OptionLocaleMaps,
} from '../lib/profilingLocale'

export type UseLocalizedQuestionnaireResult = {
  /** Questions to render (translated when locale !== en). */
  displayQuestions: ProfilingQuestionDef[]
  /** Always the English source questionnaire. */
  canonicalQuestions: ProfilingQuestionDef[]
  optionMaps: Record<string, OptionLocaleMaps>
  isTranslating: boolean
  translationError: string | null
}

export function useLocalizedQuestionnaire(
  canonicalQuestions: ProfilingQuestionDef[],
): UseLocalizedQuestionnaireResult {
  const { i18n, t } = useTranslation()
  const locale = resolveUiLanguage(i18n.language)
  const [localized, setLocalized] = useState<LocalizedQuestionnaire>(() => ({
    displayQuestions: canonicalQuestions,
    optionMaps: {},
  }))
  const [isTranslating, setIsTranslating] = useState(false)
  const [translationError, setTranslationError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const canonicalKey = useMemo(
    () => JSON.stringify(canonicalQuestions.map((q) => q.key)),
    [canonicalQuestions],
  )

  useEffect(() => {
    let cancelled = false
    const requestId = ++requestIdRef.current

    if (canonicalQuestions.length === 0) {
      setLocalized({ displayQuestions: [], optionMaps: {} })
      setIsTranslating(false)
      setTranslationError(null)
      return () => {
        cancelled = true
      }
    }

    if (locale === 'en') {
      setLocalized({ displayQuestions: canonicalQuestions, optionMaps: {} })
      setIsTranslating(false)
      setTranslationError(null)
      return () => {
        cancelled = true
      }
    }

    setIsTranslating(true)
    setTranslationError(null)
    // Show English immediately while translating.
    setLocalized({ displayQuestions: canonicalQuestions, optionMaps: {} })

    void (async () => {
      try {
        const unique = collectQuestionnaireDisplayStrings(canonicalQuestions)
        const translated = await translateTextsChunkedWithRetry({
          texts: unique,
          targetLang: locale,
          sourceLang: 'en',
        })
        if (cancelled || requestId !== requestIdRef.current) {
          return
        }
        const map = new Map<string, string>()
        unique.forEach((english, index) => {
          map.set(english, translated[index] ?? english)
        })
        setLocalized(buildLocalizedQuestionnaire(canonicalQuestions, map))
        setTranslationError(null)
      } catch (error) {
        if (cancelled || requestId !== requestIdRef.current) {
          return
        }
        setLocalized({ displayQuestions: canonicalQuestions, optionMaps: {} })
        setTranslationError(
          error instanceof Error ? error.message : t('agents.translationFailed'),
        )
      } finally {
        if (!cancelled && requestId === requestIdRef.current) {
          setIsTranslating(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
    // canonicalKey tracks identity of the question set
  }, [canonicalKey, canonicalQuestions, locale, t])

  return {
    displayQuestions: localized.displayQuestions,
    canonicalQuestions,
    optionMaps: localized.optionMaps,
    isTranslating,
    translationError,
  }
}
