import { displayLinkedInHandle } from './linkedin'

export function displayCompetitorHandle(handleOrUrl: string, platform?: string): string {
  const trimmed = handleOrUrl.trim()

  if (platform === 'linkedin' || /linkedin\.com/i.test(trimmed)) {
    return displayLinkedInHandle(trimmed)
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
