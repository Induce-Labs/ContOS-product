/**
 * Pure helpers for profiling locale mapping (no Agents API import).
 */
import type { ProfilingQuestionDef } from '../config/onboardingProfilingQuestions'
import {
  findMatchingSelectOption,
  isOtherSelectOption,
} from '../config/onboardingProfilingQuestions'
import { isSupportedLanguage, type SupportedLanguage } from '../i18n/resources'

export type OptionLocaleMaps = {
  toEnglish: Record<string, string>
  toLocale: Record<string, string>
}

export type LocalizedQuestionnaire = {
  displayQuestions: ProfilingQuestionDef[]
  optionMaps: Record<string, OptionLocaleMaps>
}

export function resolveUiLanguage(language: string | undefined): SupportedLanguage {
  const raw = (language || 'en').split('-')[0] ?? 'en'
  return isSupportedLanguage(raw) ? raw : 'en'
}

export function collectQuestionnaireDisplayStrings(
  questions: ProfilingQuestionDef[],
): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  function add(value: string | undefined) {
    const text = (value ?? '').trim()
    if (!text || seen.has(text)) return
    seen.add(text)
    ordered.push(text)
  }
  for (const question of questions) {
    add(question.question)
    add(question.sectionLabel)
    add(question.placeholder)
    if (question.input.kind === 'single_select') {
      for (const option of question.input.options) {
        add(option)
      }
    }
  }
  return ordered
}

export function buildLocalizedQuestionnaire(
  questions: ProfilingQuestionDef[],
  translationByEnglish: Map<string, string>,
): LocalizedQuestionnaire {
  const optionMaps: Record<string, OptionLocaleMaps> = {}

  const displayQuestions = questions.map((question) => {
    const tr = (value: string | undefined) => {
      if (!value) return value
      return translationByEnglish.get(value) ?? value
    }

    if (question.input.kind === 'single_select') {
      const englishOptions = [...question.input.options]
      const toEnglish: Record<string, string> = {}
      const toLocale: Record<string, string> = {}
      const displayOptions = englishOptions.map((option) => {
        const localized = translationByEnglish.get(option) ?? option
        toEnglish[localized] = option
        toLocale[option] = localized
        toEnglish[option] = option
        toLocale[localized] = localized
        return localized
      })
      optionMaps[question.key] = { toEnglish, toLocale }
      return {
        ...question,
        question: tr(question.question) ?? question.question,
        sectionLabel: tr(question.sectionLabel) ?? question.sectionLabel,
        placeholder: question.placeholder
          ? (tr(question.placeholder) ?? question.placeholder)
          : question.placeholder,
        input: {
          ...question.input,
          options: displayOptions,
          englishOptions,
        },
      }
    }

    return {
      ...question,
      question: tr(question.question) ?? question.question,
      sectionLabel: tr(question.sectionLabel) ?? question.sectionLabel,
      placeholder: question.placeholder
        ? (tr(question.placeholder) ?? question.placeholder)
        : question.placeholder,
    }
  })

  return { displayQuestions, optionMaps }
}

/**
 * Map a UI select value to English. Known option labels use the reverse map;
 * free-text "Other" bodies pass through for later translation.
 */
export function selectAnswerToEnglish(
  question: ProfilingQuestionDef,
  raw: string,
  optionMaps: OptionLocaleMaps | undefined,
): string {
  const trimmed = raw.trim()
  if (!trimmed || question.input.kind !== 'single_select') {
    return raw
  }

  const fromMap = optionMaps?.toEnglish[trimmed]
  if (fromMap && !isOtherSelectOption(fromMap)) {
    return fromMap
  }

  const englishOptions = question.input.englishOptions ?? question.input.options
  const matched = findMatchingSelectOption(
    question.input.options,
    trimmed,
    question.input.englishOptions,
  )
  if (matched.option) {
    const englishLabel =
      optionMaps?.toEnglish[matched.option] ??
      englishOptions[question.input.options.indexOf(matched.option)] ??
      matched.option
    if (!isOtherSelectOption(englishLabel)) {
      return englishLabel
    }
    return matched.otherText.trim() || trimmed
  }

  return trimmed
}

/** Skip translate API when locale is English or answer is blank. */
export function shouldTranslateAnswerToEnglish(
  sourceLang: string,
  answer: string,
): boolean {
  return sourceLang !== 'en' && answer.trim().length > 0
}

export function looksLikeUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^https?:\/\//i.test(trimmed)) return true
  try {
    const parsed = new URL(`https://${trimmed}`)
    return Boolean(parsed.hostname.includes('.'))
  } catch {
    return false
  }
}
