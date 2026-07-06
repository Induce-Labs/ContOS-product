export function displayCompetitorHandle(handleOrUrl: string): string {
  const trimmed = handleOrUrl.trim()

  const profileMatch = trimmed.match(/instagram\.com\/([^/?#]+)/i)
  if (profileMatch?.[1]) {
    return `@${profileMatch[1]}`
  }

  if (trimmed.startsWith('@')) {
    return trimmed
  }

  return trimmed
}
