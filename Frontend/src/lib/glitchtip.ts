import * as Sentry from '@sentry/react'

const ignoredStatus = new Set([400, 401, 403, 404, 409, 410, 429])
const sensitiveQuery = new Set([
  'access_token',
  'refresh_token',
  'client_secret',
  'api_key',
  'token',
  'secret',
  'password',
  'code',
])
const dropKeys = new Set([
  ...sensitiveQuery,
  'authorization',
  'cookie',
  'set-cookie',
  'contos_provision_secret',
  'postiz_token_encryption_key',
  'public_key',
])
const filtered = '[Filtered]'

const bearerPattern = /Bearer\s+\S+/gi
const posTokenPattern = /\bpos_[A-Za-z0-9_-]+/g
const jwtPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g
const assignmentPattern =
  /\b(access_token|refresh_token|client_secret|api_key|password|secret|CONTOS_PROVISION_SECRET|POSTIZ_TOKEN_ENCRYPTION_KEY)\b(\s*[=:]\s*)([^\s&"']+)/gi
const datastoreUrlPattern = /\b(?:redis|rediss|postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/\S+/gi
const credentialUrlPattern = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@[^\s]+/gi
const publicDsnPattern = /\bhttps?:\/\/[a-f0-9]{32}@/gi

type EventRecord = {
  request?: {
    url?: string
    query_string?: string | Record<string, unknown>
    headers?: unknown
    cookies?: unknown
    data?: unknown
    env?: unknown
    body?: unknown
  }
  message?: string
  exception?: { values?: Array<{ value?: string }> }
  contexts?: { response?: { status_code?: number } }
  tags?: Record<string, unknown>
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>
  [key: string]: unknown
}

function replacePattern(value: string, pattern: RegExp, replacement: string): string {
  pattern.lastIndex = 0
  return value.replace(pattern, replacement)
}

export function redactText(value: string): string {
  let text = replacePattern(value, credentialUrlPattern, filtered)
  text = replacePattern(text, publicDsnPattern, 'https://[Filtered]@')
  text = replacePattern(text, datastoreUrlPattern, filtered)
  text = replacePattern(text, bearerPattern, `Bearer ${filtered}`)
  text = replacePattern(text, posTokenPattern, filtered)
  text = replacePattern(text, jwtPattern, filtered)
  assignmentPattern.lastIndex = 0
  return text.replace(assignmentPattern, `$1$2${filtered}`)
}

export function scrubUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return redactText(url)
  }
  const keys = [...parsed.searchParams.keys()]
  for (const key of keys) {
    if (sensitiveQuery.has(key.toLowerCase())) {
      parsed.searchParams.set(key, filtered)
    }
  }
  return redactText(parsed.toString())
}

export function scrubGlitchtipEvent<T extends EventRecord>(event: T): T | null {
  const status = statusCode(event)
  if (status !== null && ignoredStatus.has(status)) {
    return null
  }
  if (event.request) {
    delete event.request.headers
    delete event.request.cookies
    delete event.request.data
    delete event.request.env
    delete event.request.body
    if (typeof event.request.url === 'string') {
      event.request.url = scrubUrl(event.request.url)
    }
    const query = event.request.query_string
    if (typeof query === 'string') {
      const scrubbed = scrubUrl(`http://scrub.local/?${query}`)
      event.request.query_string = scrubbed.split('?')[1] ?? ''
    } else if (query && typeof query === 'object') {
      for (const key of Object.keys(query)) {
        if (sensitiveQuery.has(key.toLowerCase())) {
          query[key] = filtered
        }
      }
    }
  }
  return redactValue(event) as T
}

export function initGlitchtip(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim()
  if (!dsn) {
    return
  }
  const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT?.trim()
  Sentry.init({
    dsn,
    environment: environment || undefined,
    tracesSampleRate: 0.01,
    enhanceFetchErrorMessages: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      stackFrameVariables: false,
      urlQueryParams: { deny: [...sensitiveQuery] },
    },
    integrations(defaults) {
      // SDK 11 has no autoSessionTracking flag. GlitchTip does not support sessions.
      return defaults.filter((integration) => integration.name !== 'BrowserSession')
    },
    beforeSend(event) {
      return scrubGlitchtipEvent(event as unknown as EventRecord) as typeof event | null
    },
    beforeSendTransaction(event) {
      return scrubGlitchtipEvent(event as unknown as EventRecord) as typeof event | null
    },
    beforeBreadcrumb(crumb) {
      const data = crumb.data
      if (data) {
        for (const key of Object.keys(data)) {
          const lowered = key.toLowerCase()
          if (
            lowered === 'headers' ||
            lowered === 'cookies' ||
            lowered === 'body' ||
            lowered === 'data' ||
            lowered === 'request_body' ||
            lowered === 'response_body' ||
            dropKeys.has(lowered)
          ) {
            delete data[key]
          }
        }
        if (typeof data.url === 'string') {
          data.url = scrubUrl(data.url)
        }
      }
      if (typeof crumb.message === 'string') {
        crumb.message = redactText(crumb.message)
      }
      return crumb
    },
  })
}

export function reactRootErrorHandlers(): {
  onUncaughtError: ReturnType<typeof Sentry.reactErrorHandler>
  onCaughtError: ReturnType<typeof Sentry.reactErrorHandler>
  onRecoverableError: ReturnType<typeof Sentry.reactErrorHandler>
} {
  return {
    onUncaughtError: Sentry.reactErrorHandler(),
    onCaughtError: Sentry.reactErrorHandler(),
    onRecoverableError: Sentry.reactErrorHandler(),
  }
}

export function reportServerFailure(error: unknown, statusCode: number | null): void {
  if (statusCode === null || statusCode < 500) {
    return
  }
  if (!import.meta.env.VITE_SENTRY_DSN?.trim()) {
    return
  }
  Sentry.captureException(error)
}

function statusCode(event: EventRecord): number | null {
  const fromContext = event.contexts?.response?.status_code
  if (typeof fromContext === 'number') {
    return fromContext
  }
  const tagged = event.tags?.['http.status_code']
  if (typeof tagged === 'number') {
    return tagged
  }
  if (typeof tagged === 'string' && /^\d+$/.test(tagged)) {
    return Number(tagged)
  }
  return null
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactText(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item))
  }
  if (value && typeof value === 'object') {
    const cleaned: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (dropKeys.has(key.toLowerCase())) {
        continue
      }
      cleaned[key] = redactValue(item)
    }
    return cleaned
  }
  return value
}
