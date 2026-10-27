export type SpeechResult = {
  isFinal: boolean
  0?: { transcript?: string }
}

export type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

export type SpeechHost = {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

export function getSpeechRecognition(host: SpeechHost | null | undefined): SpeechRecognitionConstructor | null {
  if (!host) return null
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null
}

/** Keep text already in the field. An empty recognition result changes nothing. */
export function appendTranscript(current: string, spoken: string): string {
  const next = spoken.replace(/\s+/g, ' ').trim()
  if (!next) return current
  const base = current.replace(/\s+$/g, '')
  if (!base) return next
  return `${base} ${next}`
}

export function dictationText(prefix: string, finals: string, interim: string): string {
  return appendTranscript(appendTranscript(prefix, finals), interim)
}

export type DictationCursor = {
  /** Final transcript already merged into the field. */
  appliedFinals: string
  /** Interim phrase written at the end of the field, if it is still there. */
  lastInterim: string
}

function normalizeSpoken(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripTrailingPhrase(field: string, phrase: string): { rest: string; removed: boolean } {
  const spoken = normalizeSpoken(phrase)
  if (!spoken) return { rest: field, removed: true }
  const trimmed = field.replace(/\s+$/g, '')
  if (!trimmed.endsWith(spoken)) return { rest: field, removed: false }
  return {
    rest: trimmed.slice(0, trimmed.length - spoken.length).replace(/\s+$/g, ''),
    removed: true,
  }
}

function dropLeadingPhrase(text: string, phrase: string): string {
  const body = normalizeSpoken(text)
  const lead = normalizeSpoken(phrase)
  if (!body || !lead) return body
  if (body === lead) return ''
  if (body.startsWith(`${lead} `)) return body.slice(lead.length + 1)
  return body
}

/**
 * Merge one recognition result into the live field.
 * Words the user deleted stay deleted; only speech added since the last result is appended.
 */
export function applyDictationResult(
  field: string,
  cursor: DictationCursor,
  finals: string,
  interim: string,
): { field: string; cursor: DictationCursor } {
  const nextFinals = normalizeSpoken(finals)
  const nextInterim = normalizeSpoken(interim)
  const applied = normalizeSpoken(cursor.appliedFinals)
  const previousInterim = normalizeSpoken(cursor.lastInterim)
  const stripped = stripTrailingPhrase(field, previousInterim)

  let finalDelta = ''
  if (nextFinals.startsWith(applied)) {
    finalDelta = nextFinals.slice(applied.length).trim()
  }

  let interimToWrite = nextInterim
  if (!stripped.removed && previousInterim) {
    finalDelta = dropLeadingPhrase(finalDelta, previousInterim)
    interimToWrite = nextInterim.startsWith(previousInterim)
      ? dropLeadingPhrase(nextInterim, previousInterim)
      : nextInterim
  }

  const nextField = appendTranscript(appendTranscript(stripped.rest, finalDelta), interimToWrite)
  return {
    field: nextField,
    cursor: { appliedFinals: nextFinals, lastInterim: nextInterim },
  }
}

export function speechLanguageTag(language: string | undefined): string {
  const raw = (language || 'en').split('-')[0]?.toLowerCase()
  switch (raw) {
    case 'hi':
      return 'hi-IN'
    case 'es':
      return 'es-ES'
    case 'fr':
      return 'fr-FR'
    case 'zh':
      return 'zh-CN'
    default:
      return 'en-US'
  }
}

export type SpeechFailure = 'permission' | 'empty' | 'unavailable' | 'failed'

/** `aborted` is a cleanup stop and is not shown to the user. */
export function speechFailure(error: string): SpeechFailure | null {
  if (error === 'aborted') return null
  if (error === 'not-allowed' || error === 'service-not-allowed') return 'permission'
  if (error === 'no-speech') return 'empty'
  if (error === 'network') return 'unavailable'
  return 'failed'
}

export function collectTranscripts(results: ArrayLike<SpeechResult>): { finals: string; interim: string } {
  let finals = ''
  let interim = ''
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]
    const transcript = result?.[0]?.transcript ?? ''
    if (result?.isFinal) finals += transcript
    else interim += transcript
  }
  return { finals, interim }
}
