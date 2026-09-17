import { displayLinkedInHandle } from './linkedin'
import { displayTwitterHandle } from './twitter'

export function displayCompetitorHandle(handleOrUrl: string, platform?: string): string {
  const trimmed = handleOrUrl.trim()

  if (platform === 'linkedin' || /linkedin\.com/i.test(trimmed)) {
    return displayLinkedInHandle(trimmed)
  }

  if (
    platform === 'twitter' ||
    /(?:twitter\.com|x\.com)/i.test(trimmed)
  ) {
    return displayTwitterHandle(trimmed)
  }

  const profileMatch = trimmed.match(/instagram\.com\/([^/?#]+)/i)
  if (profileMatch?.[1]) {
    return `@${profileMatch[1]}`
  }

  if (trimmed.startsWith('@')) {
    return trimmed
  }

  return trimmed
}
