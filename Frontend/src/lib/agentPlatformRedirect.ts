/** Client-side Chat → Instagram / LinkedIn / X agent handoff helpers. */

export type PlatformAgent = 'instagram' | 'linkedin' | 'twitter'

const PLATFORM_REQUEST_RE =
  /^(?:(?:please\s+)?(?:switch\s+to|go\s+to|open|use|run)\s+)?(?:the\s+)?(instagram|insta|ig|linkedin|twitter|x)(?:\s+agent)?[.!?]*$/i

const AFFIRMATIVE_RE =
  /^(yes|y|yeah|yep|yup|sure|ok|okay|please|do\s+it|go\s+ahead|confirm|absolutely|of\s+course)[.!]*$/i

const NEGATIVE_RE =
  /^(no|n|nope|nah|cancel|never\s*mind|dont|don't|not\s+now|stay)[.!]*$/i

export function detectPlatformRedirectRequest(text: string): PlatformAgent | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 80) return null
  const match = PLATFORM_REQUEST_RE.exec(trimmed)
  if (!match) return null
  const token = match[1].toLowerCase()
  if (token === 'instagram' || token === 'insta' || token === 'ig') return 'instagram'
  if (token === 'linkedin') return 'linkedin'
  if (token === 'twitter' || token === 'x') return 'twitter'
  return null
}

const PLATFORM_TOKEN = '(instagram|insta|ig|linkedin|twitter|x)'
const LEAD_IN = '(?:(?:ok(?:ay)?|hey|hi|so|now|please|pls|can\\s+you|could\\s+you|can\\s+u|would\\s+you|will\\s+you)[,\\s]+)*'
const TAIL = '(?:\\s+(?:please|pls|now|for\\s+me))?[\\s.!?]*$'

/** "switch to X" style commands: the platform name is the whole point of the message. */
const SWITCH_TO_RE = new RegExp(
  `^${LEAD_IN}(?:switch|change|move|go|jump)(?:\\s+me)?\\s+(?:over\\s+)?(?:to|into)\\s+(?:the\\s+|my\\s+)?${PLATFORM_TOKEN}(?:\\s+(?:agent|chat|mode|assistant))?${TAIL}`,
  'i',
)
const TAKE_ME_RE = new RegExp(
  `^${LEAD_IN}take\\s+me\\s+to\\s+(?:the\\s+)?${PLATFORM_TOKEN}(?:\\s+(?:agent|chat|mode|assistant))?${TAIL}`,
  'i',
)
/** "use / open the X agent": only counts when the word "agent" is present. */
const USE_AGENT_RE = new RegExp(
  `^${LEAD_IN}(?:use|open|run|start)\\s+(?:the\\s+|my\\s+)?${PLATFORM_TOKEN}\\s+(?:agent|assistant)${TAIL}`,
  'i',
)

function platformFromToken(token: string): PlatformAgent | null {
  const t = token.toLowerCase()
  if (t === 'instagram' || t === 'insta' || t === 'ig') return 'instagram'
  if (t === 'linkedin') return 'linkedin'
  if (t === 'twitter' || t === 'x') return 'twitter'
  return null
}

/**
 * An explicit request to change agents ("switch to instagram agent") must switch
 * immediately, from any agent. A bare platform name or a content request does not count.
 */
export function detectExplicitSwitchRequest(text: string): PlatformAgent | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 80) return null
  for (const re of [SWITCH_TO_RE, TAKE_ME_RE, USE_AGENT_RE]) {
    const match = re.exec(trimmed)
    if (match) return platformFromToken(match[1])
  }
  return null
}

const PLATFORM_PLAN_ORDER: PlatformAgent[] = ['linkedin', 'instagram', 'twitter']

/**
 * Platforms named in the message, in plan order (LinkedIn, Instagram, X).
 * Empty when none are named.
 */
export function detectNamedPlatforms(text: string): PlatformAgent[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const found = new Set<PlatformAgent>()
  if (/\blinkedin\b/i.test(trimmed)) found.add('linkedin')
  if (/\b(instagram|insta|ig)\b/i.test(trimmed)) found.add('instagram')
  if (/\btwitter\b/i.test(trimmed) || /\bx\b/i.test(trimmed)) found.add('twitter')
  return PLATFORM_PLAN_ORDER.filter((platform) => found.has(platform))
}

/**
 * When Chat is active and the message names exactly one platform, return that agent.
 * Zero or multiple named platforms (e.g. LinkedIn vs Instagram) returns null.
 */
export function detectSingleNamedPlatform(text: string): PlatformAgent | null {
  const named = detectNamedPlatforms(text)
  return named.length === 1 ? named[0] : null
}

const MULTI_PLAN_AGENTS: ReadonlySet<string> = new Set([
  'chatbot',
  'linkedin',
  'instagram',
  'twitter',
])

/**
 * Ordered platforms for a sequential plan when Chat or a content agent is
 * selected and the message names two or more platforms. Otherwise null.
 */
export function multiPlanPlatforms(current: string, text: string): PlatformAgent[] | null {
  if (!MULTI_PLAN_AGENTS.has(current)) return null
  const named = detectNamedPlatforms(text)
  return named.length >= 2 ? named : null
}

const CONTENT_AGENTS: ReadonlySet<string> = new Set(['linkedin', 'instagram', 'twitter'])

/**
 * When a content agent is selected and the message names exactly one other
 * platform, return that platform so the chip and invoke switch to it.
 * Same platform, none, two or more, or a non-content agent returns null.
 */
export function redirectTarget(current: string, text: string): PlatformAgent | null {
  if (!CONTENT_AGENTS.has(current)) return null
  const named = detectSingleNamedPlatform(text)
  if (!named || named === current) return null
  return named
}

export function isAffirmativeReply(text: string): boolean {
  return AFFIRMATIVE_RE.test(text.trim())
}

export function isNegativeReply(text: string): boolean {
  return NEGATIVE_RE.test(text.trim())
}

/** Infer platform from ContOS's prior "shall I redirect?" assistant bubble. */
export function detectPlatformFromRedirectAsk(assistantText: string): PlatformAgent | null {
  const text = assistantText.toLowerCase()
  const instagramAsk =
    text.includes('instagram agent') ||
    (text.includes('instagram') &&
      (text.includes('switch') || text.includes('redirect') || text.includes('hand')))
  const linkedinAsk =
    text.includes('linkedin agent') ||
    (text.includes('linkedin') &&
      (text.includes('switch') || text.includes('redirect') || text.includes('hand')))
  const twitterAsk =
    text.includes('twitter agent') ||
    text.includes('x agent') ||
    ((text.includes('twitter') || text.includes(' x ')) &&
      (text.includes('switch') || text.includes('redirect') || text.includes('hand')))

  const hits = [
    instagramAsk ? 'instagram' : null,
    linkedinAsk ? 'linkedin' : null,
    twitterAsk ? 'twitter' : null,
  ].filter(Boolean)

  if (hits.length === 1) return hits[0] as PlatformAgent
  return null
}

export function platformLabel(platform: PlatformAgent): string {
  if (platform === 'instagram') return 'Instagram'
  if (platform === 'linkedin') return 'LinkedIn'
  return 'X'
}
