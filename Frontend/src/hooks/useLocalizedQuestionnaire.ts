import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { logDevError, userFacingMessage } from '../lib/devLog'
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
    displayQuestions: locale === 'en' ? canonicalQuestions : [],
    optionMaps: {},
  }))
  const [isTranslating, setIsTranslating] = useState(
    () => locale !== 'en' && canonicalQuestions.length > 0,
  )
  const [translationError, setTranslationError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const canonicalKey = useMemo(
    () => JSON.stringify(canonicalQuestions.map((q) => q.key)),
    [canonicalQuestions],
  )

  // useLayoutEffect so isTranslating is true before paint — no English flash.
  useLayoutEffect(() => {
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
    // Hold empty until translated so gated UIs never flash English.
    setLocalized({ displayQuestions: [], optionMaps: {} })

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
        logDevError('localized questionnaire', {
          error: error instanceof Error ? error.message : String(error),
        })
        setTranslationError(userFacingMessage(error, t('agents.translationFailed')))
      } finally {
        if (!cancelled && requestId === requestIdRef.current) {
          setIsTranslating(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [canonicalKey, canonicalQuestions, locale, t])

  return {
    displayQuestions: localized.displayQuestions,
    canonicalQuestions,
    optionMaps: localized.optionMaps,
    isTranslating,
    translationError,
  }
}
