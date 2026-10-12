import type { ProfilingQuestionDef } from '../config/onboardingProfilingQuestions'
import {
  findMatchingSelectOption,
  isOtherSelectOption,
  parseCompetitorNames,
  serializeCompetitorNames,
} from '../config/onboardingProfilingQuestions'
import { AgentsApiError, translateTexts } from './agentsApi'
import {
  buildLocalizedQuestionnaire,
  collectQuestionnaireDisplayStrings,
  looksLikeUrl,
  resolveUiLanguage,
  selectAnswerToEnglish,
  shouldTranslateAnswerToEnglish,
  type LocalizedQuestionnaire,
  type OptionLocaleMaps,
} from './profilingLocaleCore'

export type { LocalizedQuestionnaire, OptionLocaleMaps }
export {
  buildLocalizedQuestionnaire,
  collectQuestionnaireDisplayStrings,
  looksLikeUrl,
  resolveUiLanguage,
  selectAnswerToEnglish,
  shouldTranslateAnswerToEnglish,
}

/** Backend POST /api/translate max texts per request (also keep LLM batches small). */
export const TRANSLATE_CHUNK_SIZE = 12

const inflightTranslations = new Map<string, Promise<string[]>>()

function translateRequestKey(params: {
  texts: string[]
  targetLang: string
  sourceLang: string
}): string {
  return JSON.stringify([params.sourceLang, params.targetLang, params.texts])
}

async function translateChunkOnce(params: {
  texts: string[]
  targetLang: string
  sourceLang: string
}): Promise<string[]> {
  const key = translateRequestKey(params)
  let pending = inflightTranslations.get(key)
  if (!pending) {
    pending = translateTexts({
      texts: params.texts,
      target_lang: params.targetLang,
      source_lang: params.sourceLang,
    }).finally(() => {
      inflightTranslations.delete(key)
    })
    inflightTranslations.set(key, pending)
  }
  return pending
}

export async function translateTextsChunked(params: {
  texts: string[]
  targetLang: string
  sourceLang: string
}): Promise<string[]> {
  const { texts, targetLang, sourceLang } = params
  if (texts.length === 0) {
    return []
  }
  if (sourceLang === targetLang) {
    return [...texts]
  }

  const out: string[] = []
  const chunks: string[][] = []
  for (let offset = 0; offset < texts.length; offset += TRANSLATE_CHUNK_SIZE) {
    chunks.push(texts.slice(offset, offset + TRANSLATE_CHUNK_SIZE))
  }

  const translatedChunks = await Promise.all(
    chunks.map((chunk) =>
      translateChunkOnce({
        texts: chunk,
        targetLang,
        sourceLang,
      }),
    ),
  )

  translatedChunks.forEach((translated, index) => {
    const chunk = chunks[index]
    if (translated.length !== chunk.length) {
      throw new Error(
        `Translate chunk returned ${translated.length} texts for ${chunk.length} inputs (chunk ${index}).`,
      )
    }
    out.push(...translated)
  })
  return out
}

/** Chunked translate with one delayed retry (all selector languages / new content). */
export async function translateTextsChunkedWithRetry(params: {
  texts: string[]
  targetLang: string
  sourceLang: string
  retryDelayMs?: number
}): Promise<string[]> {
  const { texts, targetLang, sourceLang, retryDelayMs = 250 } = params
  try {
    return await translateTextsChunked({ texts, targetLang, sourceLang })
  } catch {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    return translateTextsChunked({ texts, targetLang, sourceLang })
  }
}

/**
 * Convert display/draft answers to English for Supabase persistence.
 * `canonicalQuestions` must be the English questionnaire defs.
 */
export async function answersToEnglishForSave(params: {
  answers: Record<string, string>
  keys: string[]
  canonicalQuestions: ProfilingQuestionDef[]
  optionMaps: Record<string, OptionLocaleMaps>
  sourceLang: string
}): Promise<Record<string, string>> {
  const { answers, keys, canonicalQuestions, optionMaps, sourceLang } = params
  const prepared: Record<string, string> = {}
  const freeTextKeys: string[] = []
  const freeTextValues: string[] = []

  for (const key of keys) {
    const question = canonicalQuestions.find((entry) => entry.key === key)
    const raw = answers[key] ?? ''
    if (!question) {
      prepared[key] = raw
      continue
    }

    if (!shouldTranslateAnswerToEnglish(sourceLang, raw)) {
      prepared[key] = raw
      continue
    }

    if (question.input.kind === 'url' && looksLikeUrl(raw)) {
      prepared[key] = raw
      continue
    }

    if (question.input.kind === 'single_select') {
      const mapped = selectAnswerToEnglish(question, raw, optionMaps[key])
      const matched = findMatchingSelectOption(question.input.options, mapped)
      if (matched.option && !isOtherSelectOption(matched.option)) {
        prepared[key] = matched.option
        continue
      }
      const body = matched.otherText.trim() || mapped
      if (!body.trim() || isOtherSelectOption(body)) {
        prepared[key] = body
        continue
      }
      freeTextKeys.push(key)
      freeTextValues.push(body)
      prepared[key] = body
      continue
    }

    if (question.input.kind === 'competitor_names') {
      const names = parseCompetitorNames(raw)
      const nonEmptyIndexes: number[] = []
      const nonEmpty: string[] = []
      names.forEach((name, index) => {
        if (name.trim()) {
          nonEmptyIndexes.push(index)
          nonEmpty.push(name)
        }
      })
      if (nonEmpty.length === 0) {
        prepared[key] = serializeCompetitorNames(names)
        continue
      }
      freeTextKeys.push(key)
      freeTextValues.push(JSON.stringify({ names, nonEmptyIndexes, nonEmpty }))
      prepared[key] = raw
      continue
    }

    freeTextKeys.push(key)
    freeTextValues.push(raw)
    prepared[key] = raw
  }

  if (freeTextValues.length === 0) {
    return prepared
  }

  const flatTexts: string[] = []
  const flatMeta: Array<
    | { kind: 'plain'; key: string }
    | { kind: 'competitors'; key: string; names: string[]; nonEmptyIndexes: number[] }
  > = []

  for (let i = 0; i < freeTextKeys.length; i++) {
    const key = freeTextKeys[i]!
    const question = canonicalQuestions.find((entry) => entry.key === key)
    const value = freeTextValues[i]!
    if (question?.input.kind === 'competitor_names') {
      try {
        const parsed = JSON.parse(value) as {
          names: string[]
          nonEmptyIndexes: number[]
          nonEmpty: string[]
        }
        flatMeta.push({
          kind: 'competitors',
          key,
          names: parsed.names,
          nonEmptyIndexes: parsed.nonEmptyIndexes,
        })
        flatTexts.push(...parsed.nonEmpty)
      } catch (error) {
        throw new AgentsApiError(
          `Failed to parse competitor names payload for key "${key}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          500,
        )
      }
    } else {
      flatMeta.push({ kind: 'plain', key })
      flatTexts.push(value)
    }
  }

  const translatedFlat = await translateTextsChunkedWithRetry({
    texts: flatTexts,
    targetLang: 'en',
    sourceLang,
  })

  let cursor = 0
  for (const meta of flatMeta) {
    if (meta.kind === 'plain') {
      prepared[meta.key] = translatedFlat[cursor] ?? prepared[meta.key]
      cursor += 1
      continue
    }
    const count = meta.nonEmptyIndexes.length
    const slice = translatedFlat.slice(cursor, cursor + count)
    cursor += count
    const nextNames = [...meta.names]
    meta.nonEmptyIndexes.forEach((nameIndex, i) => {
      nextNames[nameIndex] = slice[i] ?? meta.names[nameIndex]!
    })
    prepared[meta.key] = serializeCompetitorNames(nextNames)
  }

  return prepared
}

/** Translate stored English answers to the UI locale for draft display. */
export async function answersToLocaleForDisplay(params: {
  englishAnswers: Record<string, string>
  canonicalQuestions: ProfilingQuestionDef[]
  optionMaps: Record<string, OptionLocaleMaps>
  targetLang: string
}): Promise<Record<string, string>> {
  const { englishAnswers, canonicalQuestions, optionMaps, targetLang } = params
  if (targetLang === 'en') {
    return { ...englishAnswers }
  }

  const keys = Object.keys(englishAnswers)
  const out: Record<string, string> = { ...englishAnswers }
  const freeKeys: string[] = []
  const freeValues: string[] = []

  for (const key of keys) {
    const question = canonicalQuestions.find((entry) => entry.key === key)
    const raw = englishAnswers[key] ?? ''
    if (!raw.trim()) {
      continue
    }
    if (!question) {
      freeKeys.push(key)
      freeValues.push(raw)
      continue
    }
    if (question.input.kind === 'url' && looksLikeUrl(raw)) {
      continue
    }
    if (question.input.kind === 'single_select') {
      const matched = findMatchingSelectOption(question.input.options, raw)
      if (matched.option && !isOtherSelectOption(matched.option)) {
        out[key] = optionMaps[key]?.toLocale[matched.option] ?? matched.option
        continue
      }
      const body = matched.otherText.trim() || raw
      freeKeys.push(key)
      freeValues.push(body)
      continue
    }
    if (question.input.kind === 'competitor_names') {
      freeKeys.push(key)
      freeValues.push(JSON.stringify(parseCompetitorNames(raw)))
      continue
    }
    freeKeys.push(key)
    freeValues.push(raw)
  }

  if (freeValues.length === 0) {
    return out
  }

  const flatTexts: string[] = []
  const flatMeta: Array<
    | { kind: 'plain'; key: string }
    | { kind: 'competitors'; key: string; slots: string[] }
  > = []

  for (let i = 0; i < freeKeys.length; i++) {
    const key = freeKeys[i]!
    const question = canonicalQuestions.find((entry) => entry.key === key)
    const value = freeValues[i]!
    if (question?.input.kind === 'competitor_names') {
      try {
        const slots = JSON.parse(value) as string[]
        flatMeta.push({ kind: 'competitors', key, slots })
        for (const slot of slots) {
          if (slot.trim()) flatTexts.push(slot)
        }
      } catch (error) {
        throw new AgentsApiError(
          `Failed to parse competitor display payload for key "${key}": ${
            error instanceof Error ? error.message : String(error)
          }`,
          500,
        )
      }
    } else {
      flatMeta.push({ kind: 'plain', key })
      flatTexts.push(value)
    }
  }

  const translatedFlat = await translateTextsChunkedWithRetry({
    texts: flatTexts,
    targetLang,
    sourceLang: 'en',
  })

  let cursor = 0
  for (const meta of flatMeta) {
    if (meta.kind === 'plain') {
      out[meta.key] = translatedFlat[cursor] ?? out[meta.key]
      cursor += 1
      continue
    }
    const nextSlots = meta.slots.map((slot) => {
      if (!slot.trim()) return slot
      const translated = translatedFlat[cursor] ?? slot
      cursor += 1
      return translated
    })
    out[meta.key] = serializeCompetitorNames(nextSlots)
  }

  return out
}
