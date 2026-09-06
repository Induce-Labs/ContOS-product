const INSTAGRAM_PROFILE_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)\/?(?:\?.*)?$/

const INSTAGRAM_HANDLE_PATTERN = /^@?([a-zA-Z0-9._]{1,30})$/

export type InstagramValidationResult =
  | { valid: true; normalized: string; handle: string }
  | { valid: false; message: string }

export function validateInstagramInput(rawValue: string): InstagramValidationResult {
  const value = rawValue.trim()

  if (!value) {
    return { valid: false, message: 'competitors.validation.instagramRequired' }
  }

  const profileMatch = value.match(INSTAGRAM_PROFILE_PATTERN)

  if (profileMatch) {
    const handle = profileMatch[1]

    if (['p', 'reel', 'reels', 'stories', 'explore'].includes(handle.toLowerCase())) {
      return {
        valid: false,
        message: 'competitors.validation.instagramNotPostOrExplore',
      }
    }

    return {
      valid: true,
      handle,
      normalized: `https://www.instagram.com/${handle}/`,
    }
  }

  const handleMatch = value.match(INSTAGRAM_HANDLE_PATTERN)

  if (handleMatch) {
    const handle = handleMatch[1]
    return {
      valid: true,
      handle,
      normalized: `https://www.instagram.com/${handle}/`,
    }
  }

  return {
    valid: false,
    message: 'competitors.validation.instagramInvalid',
  }
}

export function getInstagramHandle(handleOrUrl: string): string {
  const result = validateInstagramInput(handleOrUrl)
  if (!result.valid) {
    return handleOrUrl.trim().toLowerCase()
  }

  return result.handle.toLowerCase()
}

export function normalizeCompetitorInputs(values: string[]): string[] {
  const seenHandles = new Set<string>()
  const normalizedValues: string[] = []

  for (const value of values) {
    const result = validateInstagramInput(value)

    if (!result.valid) {
      throw new Error(result.message)
    }

    const handleKey = result.handle.toLowerCase()

    if (seenHandles.has(handleKey)) {
      throw new Error(`Duplicate competitor: @${result.handle}`)
    }

    seenHandles.add(handleKey)
    normalizedValues.push(result.normalized)
  }

  return normalizedValues
}
