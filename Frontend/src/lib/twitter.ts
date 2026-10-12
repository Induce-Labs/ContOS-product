const TWITTER_PROFILE_URL_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,15})\/?(?:\?.*)?$/i

const TWITTER_HANDLE_PATTERN = /^@?([A-Za-z0-9_]{1,15})$/

const RESERVED_PATHS = new Set([
  'home',
  'explore',
  'search',
  'i',
  'intent',
  'settings',
  'messages',
  'notifications',
  'compose',
  'login',
  'signup',
  'share',
])

export type TwitterValidationResult =
  | { valid: true; normalized: string; handle: string }
  | { valid: false; message: string }

export function validateTwitterInput(rawValue: string): TwitterValidationResult {
  const value = rawValue.trim()

  if (!value) {
    return { valid: false, message: 'competitors.validation.twitterRequired' }
  }

  const profileMatch = value.match(TWITTER_PROFILE_URL_PATTERN)
  if (profileMatch?.[1]) {
    const handle = profileMatch[1]
    if (RESERVED_PATHS.has(handle.toLowerCase())) {
      return {
        valid: false,
        message: 'competitors.validation.twitterInvalidUrl',
      }
    }
    return {
      valid: true,
      handle,
      normalized: `https://x.com/${handle}`,
    }
  }

  if (/twitter\.com|x\.com/i.test(value)) {
    return {
      valid: false,
      message: 'competitors.validation.twitterInvalidUrl',
    }
  }

  const handleMatch = value.match(TWITTER_HANDLE_PATTERN)
  if (handleMatch?.[1]) {
    const handle = handleMatch[1]
    return {
      valid: true,
      handle,
      normalized: `https://x.com/${handle}`,
    }
  }

  return {
    valid: false,
    message: 'competitors.validation.twitterInvalidHandle',
  }
}

export function getTwitterHandle(handleOrUrl: string): string {
  const result = validateTwitterInput(handleOrUrl)
  if (!result.valid) {
    return handleOrUrl.trim().replace(/^@/, '').toLowerCase()
  }

  return result.handle.toLowerCase()
}

export function normalizeTwitterInputs(values: string[]): string[] {
  const seen = new Set<string>()
  const normalizedValues: string[] = []

  for (const value of values) {
    const result = validateTwitterInput(value)

    if (!result.valid) {
      throw new Error(result.message)
    }

    const key = result.handle.toLowerCase()
    if (seen.has(key)) {
      throw new Error(`Duplicate Twitter competitor: @${result.handle}`)
    }

    seen.add(key)
    normalizedValues.push(result.normalized)
  }

  return normalizedValues
}

export function displayTwitterHandle(handleOrUrl: string): string {
  const result = validateTwitterInput(handleOrUrl)
  if (result.valid) {
    return `@${result.handle}`
  }

  const match = handleOrUrl.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/i)
  if (match?.[1]) {
    return `@${match[1]}`
  }

  const trimmed = handleOrUrl.trim()
  return trimmed.startsWith('@') ? trimmed : trimmed
}
