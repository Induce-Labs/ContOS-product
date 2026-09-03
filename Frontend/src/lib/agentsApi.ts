import { supabase, getApiBaseUrl } from './supabase'

export class AgentsApiError extends Error {
  readonly statusCode: number | null

  constructor(message: string, statusCode: number | null = null) {
    super(message)
    this.name = 'AgentsApiError'
    this.statusCode = statusCode
  }
}

export type AgentType = 'chatbot' | 'linkedin' | 'instagram' | 'playbook' | 'twitter'

export type AgentsInvokeRequest = {
  avatar_id: string
  agent_type: AgentType
  user_input: string
  live_mode?: boolean
  chatbot_context_on?: boolean
  competitor_url?: string | null
  tagged_avatar_ids?: string[]
  /** Prior turns in this thread (excludes the message about to be sent). */
  chat_history?: Array<{ role: 'user' | 'assistant'; content: string }>
}

export type AgentsSseHandlers = {
  onStatus?: (data: Record<string, unknown>) => void
  onToken?: (token: string) => void
  onComplete?: (data: Record<string, unknown>) => void
  onError?: (message: string) => void
}

function requireAgentApiBaseUrl(): string {
  const raw = import.meta.env.VITE_AGENT_API_BASE_URL?.trim().replace(/\/+$/, '')
  if (!raw) {
    throw new AgentsApiError(
      'Missing VITE_AGENT_API_BASE_URL. Set it to http://localhost:8001 for local Agents.',
    )
  }

  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    if (
      url.protocol === 'http:' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1'
    ) {
      url.protocol = 'https:'
    }
    return url.origin
  } catch {
    throw new AgentsApiError(`Invalid VITE_AGENT_API_BASE_URL: "${raw}"`)
  }
}

export function getAgentApiBaseUrl(): string {
  return requireAgentApiBaseUrl()
}

/** Scrape backend remains on VITE_API_BASE_URL; agents use a separate origin. */
export function getScrapeApiBaseUrl(): string {
  return getApiBaseUrl()
}

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) {
    throw new AgentsApiError(`Failed to read auth session: ${sessionError.message}`)
  }

  if (!session?.access_token) {
    throw new AgentsApiError('You must be signed in to use ContOS Agents.')
  }

  return session.access_token
}

function parseSseChunk(
  buffer: string,
  handlers: AgentsSseHandlers,
): string {
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''

  for (const part of parts) {
    const lines = part.split('\n')
    let eventName = 'message'
    const dataLines: string[] = []

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim())
      }
    }

    if (dataLines.length === 0) {
      continue
    }

    const raw = dataLines.join('\n')
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(raw) as Record<string, unknown>
    } catch {
      data = { raw }
    }

    if (eventName === 'status') {
      handlers.onStatus?.(data)
    } else if (eventName === 'token') {
      const token = typeof data.token === 'string' ? data.token : ''
      if (token) {
        handlers.onToken?.(token)
      }
    } else if (eventName === 'complete') {
      handlers.onComplete?.(data)
    } else if (eventName === 'error') {
      const message =
        typeof data.error === 'string'
          ? data.error
          : 'Agent stream failed unexpectedly.'
      handlers.onError?.(message)
    }
  }

  return rest
}

export async function invokeAgentStream(
  body: AgentsInvokeRequest,
  handlers: AgentsSseHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const token = await getAccessToken()
  const base = getAgentApiBaseUrl()

  const response = await fetch(`${base}/api/agents/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      avatar_id: body.avatar_id,
      agent_type: body.agent_type,
      user_input: body.user_input,
      live_mode: body.live_mode ?? false,
      chatbot_context_on: body.chatbot_context_on ?? true,
      competitor_url: body.competitor_url ?? null,
      tagged_avatar_ids: body.tagged_avatar_ids?.length
        ? body.tagged_avatar_ids
        : undefined,
      chat_history:
        body.chat_history && body.chat_history.length > 0
          ? body.chat_history
          : undefined,
    }),
    signal,
  })

  if (!response.ok) {
    const responseBody = await response.text()
    throw new AgentsApiError(
      `Agents invoke failed (status ${response.status}): ${responseBody || 'no response body'}`,
      response.status,
    )
  }

  if (!response.body) {
    throw new AgentsApiError('Agents invoke returned an empty stream body.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    buffer = parseSseChunk(buffer, handlers)
  }

  if (buffer.trim()) {
    parseSseChunk(`${buffer}\n\n`, handlers)
  }
}

/** Legacy seed text — kept so older stored welcome bubbles still skip in chat memory. */
export const AGENTS_WELCOME_MESSAGE =
  'Research for this avatar is ready. I can turn competitor data into strategies, content ideas, or comparisons. What do you want to focus on — LinkedIn, Instagram, or a growth playbook?'

const WELCOME_GREETING_RE =
  /^Good (morning|afternoon|evening|Morning|Afternoon|Evening),\s+.+/

export function timeOfDayGreeting(now: Date = new Date()): 'Good morning' | 'Good afternoon' | 'Good evening' {
  const hour = now.getHours()
  if (hour >= 5 && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** First name from auth metadata, else email local-part, else "there". */
export function getUserFirstName(user: {
  email?: string | null
  user_metadata?: Record<string, unknown> | null
} | null | undefined): string {
  const meta = user?.user_metadata ?? {}
  const rawCandidates = [
    meta.full_name,
    meta.name,
    meta.given_name,
    meta.first_name,
  ]

  for (const candidate of rawCandidates) {
    if (typeof candidate !== 'string') continue
    const trimmed = candidate.trim()
    if (!trimmed) continue
    const first = trimmed.split(/\s+/)[0]
    if (first) return first
  }

  const email = user?.email?.trim()
  if (email) {
    const local = email.split('@')[0]?.trim()
    if (local) {
      const token = local.split(/[._+-]/)[0]
      if (token) {
        return token.charAt(0).toUpperCase() + token.slice(1)
      }
    }
  }

  return 'there'
}

/** Claude-style empty-state line: "Good morning, Sara" */
export function buildAgentsWelcomeMessage(
  firstName: string,
  now: Date = new Date(),
): string {
  const name = firstName.trim() || 'there'
  return `${timeOfDayGreeting(now)}, ${name}`
}

export function isAgentsWelcomeMessage(content: string): boolean {
  const text = content.trim()
  if (!text) return false
  if (text === AGENTS_WELCOME_MESSAGE) return true
  if (text.includes(AGENTS_WELCOME_MESSAGE) && WELCOME_GREETING_RE.test(text)) {
    return true
  }
  // Short Claude-style greeting only (no trailing pitch).
  return WELCOME_GREETING_RE.test(text) && !text.includes('\n') && text.length < 80
}
