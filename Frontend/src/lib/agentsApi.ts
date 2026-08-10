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
  project_id: string
  agent_type: AgentType
  user_input: string
  live_mode?: boolean
  chatbot_context_on?: boolean
  competitor_url?: string | null
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
      project_id: body.project_id,
      agent_type: body.agent_type,
      user_input: body.user_input,
      live_mode: body.live_mode ?? false,
      chatbot_context_on: body.chatbot_context_on ?? true,
      competitor_url: body.competitor_url ?? null,
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

export const AGENTS_WELCOME_MESSAGE =
  'Research for this project is ready. I can turn competitor data into strategies, content ideas, or comparisons. What do you want to focus on — LinkedIn, Instagram, or a growth playbook?'
