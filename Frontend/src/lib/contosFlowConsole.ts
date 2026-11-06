import { getAccessToken as getAuthAccessToken } from './auth'
import { getAgentApiBaseUrl } from './agentsApi'

export type ContosFlowEvent = {
  id?: string
  channel?: string
  message?: string
  level?: string
  line?: string
  fields?: Record<string, unknown>
  ts?: number
}

const seenEventIds = new Set<string>()
const MAX_SEEN = 500

/** Chrome DevTools ContOS flow logs — Vite DEV only. */
export function contosFlowConsoleEnabled(): boolean {
  return Boolean(import.meta.env.DEV)
}

export function logContosFlowEvent(event: ContosFlowEvent | null | undefined): void {
  if (!contosFlowConsoleEnabled() || !event) {
    return
  }
  const id = typeof event.id === 'string' ? event.id : ''
  if (id) {
    if (seenEventIds.has(id)) {
      return
    }
    seenEventIds.add(id)
    if (seenEventIds.size > MAX_SEEN) {
      const first = seenEventIds.values().next().value
      if (typeof first === 'string') {
        seenEventIds.delete(first)
      }
    }
  }

  const line =
    typeof event.line === 'string' && event.line.trim()
      ? event.line.trim()
      : formatContosFlowLine(event)
  if (!line) {
    return
  }
  // Dual-emit so Custom levels (Verbose off / Warnings on) still show ContOS.
  console.log(line)
  console.warn(line)
}

/** DEV breadcrumb — always console.log, never throws. */
export function logContosFlowBreadcrumb(message: string, extra?: Record<string, unknown>): void {
  if (!contosFlowConsoleEnabled()) {
    return
  }
  const suffix =
    extra && Object.keys(extra).length > 0
      ? ` | ${Object.entries(extra)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(' | ')}`
      : ''
  const line = `[CONTOS:FLOW] ${message}${suffix}`
  console.log(line)
  console.warn(line)
}

export function formatContosFlowLine(event: ContosFlowEvent): string {
  const channel = String(event.channel || 'FLOW').trim() || 'FLOW'
  const message = String(event.message || '').trim()
  if (!message) {
    return ''
  }
  const parts = [`[CONTOS:${channel}] ${message}`]
  const fields = event.fields
  if (fields && typeof fields === 'object') {
    for (const [key, value] of Object.entries(fields)) {
      if (value === null || value === undefined) {
        continue
      }
      parts.push(`${key}=${String(value)}`)
    }
  }
  return parts.join(' | ')
}

/** Pull Celery/async ContOS flow events into Chrome Console. Never throws. */
export async function pullContosFlowEvents(
  avatarId: string,
  signal?: AbortSignal,
): Promise<number> {
  if (!contosFlowConsoleEnabled() || !avatarId.trim()) {
    return 0
  }
  try {
    const token = await getAuthAccessToken()
    const response = await fetch(
      `${getAgentApiBaseUrl()}/api/dev/flow-events?avatar_id=${encodeURIComponent(avatarId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal,
      },
    )
    if (!response.ok) {
      return 0
    }
    const payload = (await response.json().catch(() => ({}))) as {
      events?: ContosFlowEvent[]
    }
    const events = Array.isArray(payload.events) ? payload.events : []
    for (const event of events) {
      logContosFlowEvent(event)
    }
    return events.length
  } catch {
    return 0
  }
}
