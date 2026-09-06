const LINKEDIN_PROFILE_URL_PATTERN =
  /^(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)\/?(?:\?.*)?$/i

const LINKEDIN_SLUG_PATTERN = /^([a-zA-Z0-9\-_%]{3,100})$/

export type LinkedInValidationResult =
  | { valid: true; normalized: string; slug: string }
  | { valid: false; message: string }

export function validateLinkedInInput(rawValue: string): LinkedInValidationResult {
  const value = rawValue.trim()

  if (!value) {
    return { valid: false, message: 'competitors.validation.linkedinRequired' }
  }

  if (/linkedin\.com\/company\//i.test(value)) {
    return {
      valid: false,
      message: 'competitors.validation.linkedinNotCompany',
    }
  }

  const profileMatch = value.match(LINKEDIN_PROFILE_URL_PATTERN)
  if (profileMatch?.[1]) {
    const slug = decodeURIComponent(profileMatch[1])
    return {
      valid: true,
      slug,
      normalized: `https://www.linkedin.com/in/${slug}/`,
    }
  }

  if (value.includes('linkedin.com')) {
    return {
      valid: false,
      message: 'competitors.validation.linkedinInvalidUrl',
    }
  }

  const slugMatch = value.replace(/^@/, '').match(LINKEDIN_SLUG_PATTERN)
  if (slugMatch?.[1]) {
    const slug = slugMatch[1]
    return {
      valid: true,
      slug,
      normalized: `https://www.linkedin.com/in/${slug}/`,
    }
  }

  return {
    valid: false,
    message: 'competitors.validation.linkedinInvalidSlug',
  }
}

export function getLinkedInSlug(handleOrUrl: string): string {
  const result = validateLinkedInInput(handleOrUrl)
  if (!result.valid) {
    return handleOrUrl.trim().toLowerCase()
  }

  return result.slug.toLowerCase()
}

export function normalizeLinkedInInputs(values: string[]): string[] {
  const seen = new Set<string>()
  const normalizedValues: string[] = []

  for (const value of values) {
    const result = validateLinkedInInput(value)

    if (!result.valid) {
      throw new Error(result.message)
    }

    const key = result.slug.toLowerCase()
    if (seen.has(key)) {
      throw new Error(`Duplicate LinkedIn competitor: ${result.slug}`)
    }

    seen.add(key)
    normalizedValues.push(result.normalized)
  }

  return normalizedValues
}

export function displayLinkedInHandle(handleOrUrl: string): string {
  const result = validateLinkedInInput(handleOrUrl)
  if (result.valid) {
    return result.slug
  }

  const match = handleOrUrl.match(/linkedin\.com\/in\/([^/?#]+)/i)
  if (match?.[1]) {
    return decodeURIComponent(match[1])
  }

  return handleOrUrl.trim()
}
