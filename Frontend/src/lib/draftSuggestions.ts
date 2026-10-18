/**
 * Draft text may contain **bold** spans: details the assistant suggested because the user
 * had not given them. They stay bold until the user changes them or says "confirm".
 */

export type TextSegment = { text: string; suggestion: boolean }

/** Draft text fields in agent output; keep in sync with DRAFT_TEXT_KEYS in the agents backend. */
const DRAFT_TEXT_KEYS = new Set([
  'post_structure',
  'full_tweet',
  'copy_paste_post',
  'caption',
  'hook',
  'cta',
  'tweets',
])

const BOLD_RE = /\*\*([^*]+?)\*\*/g

export function splitSuggestions(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let last = 0
  for (const match of text.matchAll(BOLD_RE)) {
    const start = match.index ?? 0
    if (start > last) segments.push({ text: text.slice(last, start), suggestion: false })
    segments.push({ text: match[1], suggestion: true })
    last = start + match[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last), suggestion: false })
  return segments
}

export function stripSuggestionMarkers(text: string): string {
  return text.replace(BOLD_RE, '$1')
}

export function hasSuggestions(text: string): boolean {
  return new RegExp(BOLD_RE.source).test(text)
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function walk(value: unknown, visit: (key: string, text: string) => void, key = ''): void {
  if (typeof value === 'string') {
    if (DRAFT_TEXT_KEYS.has(key)) visit(key, value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, key)
    return
  }
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) walk(v, visit, k)
  }
}

export function outputHasSuggestions(output: unknown): boolean {
  let found = false
  walk(output, (_key, text) => {
    if (hasSuggestions(text)) found = true
  })
  return found
}

function stripDeep(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    return DRAFT_TEXT_KEYS.has(key) ? stripSuggestionMarkers(value) : value
  }
  if (Array.isArray(value)) return value.map((item) => stripDeep(item, key))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripDeep(v, k)]))
  }
  return value
}

/**
 * The confirmed version of a draft: bold markers removed, the planning chatter cleared,
 * and a short note shown above the final text.
 */
export function confirmSuggestions(output: unknown, note: string): unknown {
  const stripped = stripDeep(output)
  if (!isRecord(stripped)) return stripped
  return { ...stripped, reply: note, thesis: '', next_question: '', ideas: [] }
}

const CONFIRM_RE =
  /^(?:(?:ok(?:ay)?|yes|yep|yeah|sure|great|perfect|looks\s+good|all\s+good|that\s+works)[,.!\s]+)*(?:i\s+)?(?:confirm(?:ed)?(?:\s+(?:it|this|that|the\s+(?:draft|post|tweet)|draft|post))?|that'?s\s+final|it'?s\s+final|finali[sz]e(?:\s+(?:it|this))?)[\s.!]*$/i

/** A short message whose whole meaning is "confirm" (not "confirm the switch" or a question). */
export function isConfirmMessage(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 48) return false
  return CONFIRM_RE.test(trimmed)
}
