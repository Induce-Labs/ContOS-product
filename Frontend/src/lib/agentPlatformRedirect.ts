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
