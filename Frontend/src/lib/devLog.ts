import { redactText } from './glitchtip'

const droppedKeys = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'headers',
  'body',
  'data',
  'token',
  'password',
  'access_token',
  'refresh_token',
  'client_secret',
  'api_key',
  'secret',
])

/** ContOS sentences written for the user. Anything else stays off the screen. */
const allowlistedPrefixes = [
  'Postiz authorization is no longer valid; reconnect required.',
  'Connect LinkedIn or X for this avatar',
  'Connect LinkedIn for this project only.',
  'Post content must not be empty.',
  'content must be at most',
  'A post may include at most',
  "Post was not found for this avatar's",
  'This project cannot select a LinkedIn account from a list.',
]

type StatusError = Error & { statusCode?: number | null }

function statusCodeOf(error: StatusError): number | null {
  return typeof error.statusCode === 'number' ? error.statusCode : null
}

/**
 * Status for an error that wraps a remote failure.
 * An explicit null statusCode means the message was written for the user.
 * Missing status on a wrapped cause is treated as a server failure (500).
 */
export function remoteStatusCode(
  cause: unknown,
  statusCode?: number | null,
): number | null {
  if (statusCode !== undefined) {
    return statusCode
  }
  if (cause === undefined) {
    return null
  }
  if (cause && typeof cause === 'object') {
    const record = cause as { status?: unknown; statusCode?: unknown }
    if (typeof record.statusCode === 'number') {
      return record.statusCode
    }
    if (record.statusCode === null) {
      return null
    }
    if (typeof record.status === 'number') {
      return record.status
    }
  }
  return 500
}

export function isAllowlistedUserMessage(message: string): boolean {
  const text = message.trim()
  return allowlistedPrefixes.some(
    (prefix) => text === prefix || text.startsWith(prefix),
  )
}

/**
 * Friendly UI text. Null status means a frontend check. Server text is shown
 * only when it matches the allowlist. 5xx and unknown 4xx use the fallback.
 */
export function userFacingMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) {
    return fallback
  }
  const status = statusCodeOf(error)
  if (status === null) {
    return error.message
  }
  if (status >= 500 || !isAllowlistedUserMessage(error.message)) {
    return fallback
  }
  return error.message
}

/** Development-only console line. Production builds print nothing. */
export function logDevError(
  label: string,
  details: Record<string, unknown>,
): void {
  if (!import.meta.env.DEV) {
    return
  }
  const safe: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(details)) {
    if (droppedKeys.has(key.toLowerCase())) {
      continue
    }
    if (typeof value === 'string') {
      safe[key] = redactText(value)
    } else if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      safe[key] = value
    }
  }
  console.error(`[ContOS API Error] ${redactText(label)}`, safe)
}
