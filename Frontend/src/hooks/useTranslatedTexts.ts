import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isSupportedLanguage, type SupportedLanguage } from '../i18n'
import { translateTextsChunkedWithRetry } from '../lib/profilingLocale'

const clientCache = new Map<string, string>()

function cacheKey(text: string, targetLang: string, sourceLang: string): string {
  return `${sourceLang}|${targetLang}|${text}`
}

export type UseTranslatedTextsResult = {
  texts: string[]
  isTranslating: boolean
  error: string | null
}

/**
 * On-demand translation for scraped/generated content.
 * Re-runs whenever `inputs` change (e.g. new competitor summary after scrape)
 * or when the UI language changes. Supports en/hi/zh/fr/es.
 * English (or same source/target) returns inputs unchanged.
 */
export function useTranslatedTexts(
  inputs: string[],
  options?: { sourceLang?: string },
): UseTranslatedTextsResult {
  const { i18n, t } = useTranslation()
  const sourceLang = options?.sourceLang ?? 'en'
  const rawLang = i18n.language?.split('-')[0] ?? 'en'
  const targetLang: SupportedLanguage = isSupportedLanguage(rawLang) ? rawLang : 'en'

  const inputsKey = useMemo(() => JSON.stringify(inputs), [inputs])
  const stableInputs = useMemo(() => inputs, [inputsKey])

  const [texts, setTexts] = useState<string[]>(stableInputs)
  const [isTranslating, setIsTranslating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (targetLang === sourceLang) {
      setTexts(stableInputs)
      setIsTranslating(false)
      setError(null)
      return
    }

    const requestId = ++requestIdRef.current
    const resolved: string[] = new Array(stableInputs.length)
    const toFetch: { index: number; text: string }[] = []
    const uniquePending = new Map<string, number[]>()

    stableInputs.forEach((text, index) => {
      if (!text.trim()) {
        resolved[index] = text
        return
      }
      const key = cacheKey(text, targetLang, sourceLang)
      const cached = clientCache.get(key)
      if (cached !== undefined) {
        resolved[index] = cached
        return
      }
      const existing = uniquePending.get(text)
      if (existing) {
        existing.push(index)
      } else {
        uniquePending.set(text, [index])
        toFetch.push({ index, text })
      }
    })

    if (toFetch.length === 0) {
      setTexts(resolved.map((value, index) => value ?? stableInputs[index]))
      setIsTranslating(false)
      setError(null)
      return
    }

    setIsTranslating(true)
    setError(null)
    // Show source while translating so the UI does not go blank.
    setTexts(stableInputs)

    void (async () => {
      try {
        const uniqueTexts = toFetch.map((item) => item.text)
        const translations = await translateTextsChunkedWithRetry({
          texts: uniqueTexts,
          targetLang,
          sourceLang,
        })
        if (requestId !== requestIdRef.current) {
          return
        }
        uniqueTexts.forEach((original, fetchIndex) => {
          const translated = translations[fetchIndex] ?? original
          clientCache.set(cacheKey(original, targetLang, sourceLang), translated)
          for (const index of uniquePending.get(original) ?? []) {
            resolved[index] = translated
          }
        })
        setTexts(resolved.map((value, index) => value ?? stableInputs[index]))
        setError(null)
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return
        }
        setTexts(stableInputs)
        setError(
          err instanceof Error
            ? err.message
            : t('agents.translationFailed'),
        )
      } finally {
        if (requestId === requestIdRef.current) {
          setIsTranslating(false)
        }
      }
    })()
  }, [stableInputs, targetLang, sourceLang, t])

  return { texts, isTranslating, error }
}
