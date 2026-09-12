/** Client-side Chat → Instagram / LinkedIn agent handoff helpers. */

export type PlatformAgent = 'instagram' | 'linkedin'

const PLATFORM_REQUEST_RE =
  /^(?:(?:please\s+)?(?:switch\s+to|go\s+to|open|use|run)\s+)?(?:the\s+)?(instagram|insta|ig|linkedin)(?:\s+agent)?[.!?]*$/i

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

  if (instagramAsk && !linkedinAsk) return 'instagram'
  if (linkedinAsk && !instagramAsk) return 'linkedin'
  return null
}

export function platformLabel(platform: PlatformAgent): string {
  return platform === 'instagram' ? 'Instagram' : 'LinkedIn'
}
