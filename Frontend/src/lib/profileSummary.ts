import { AgentsApiError, getAgentApiBaseUrl } from './agentsApi'
import { supabase } from './supabase'

export type ProfileSummarizeResponse = {
  avatar_id: string
  profile_summary: string
  status: string
  generated_at?: string | null
  cached?: boolean
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
    throw new AgentsApiError('You must be signed in to generate a profile summary.')
  }

  return session.access_token
}

export async function summarizeProfiling(
  avatarId: string,
  options?: { force?: boolean; timeoutMs?: number },
): Promise<ProfileSummarizeResponse> {
  const timeoutMs = options?.timeoutMs ?? 240_000
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const token = await getAccessToken()
    const response = await fetch(`${getAgentApiBaseUrl()}/api/profiling/summarize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        avatar_id: avatarId,
        force: options?.force ?? false,
      }),
      signal: controller.signal,
    })

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>

    if (!response.ok) {
      const detail = payload.detail
      const message =
        typeof detail === 'object' && detail && 'message' in detail
          ? String((detail as { message: unknown }).message)
          : typeof detail === 'string'
            ? detail
            : `Profile summary request failed (${response.status}).`
      throw new AgentsApiError(message, response.status)
    }

    return payload as ProfileSummarizeResponse
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AgentsApiError(
        `Profile summary timed out after ${Math.round(timeoutMs / 1000)}s.`,
      )
    }
    if (error instanceof AgentsApiError) {
      throw error
    }
    throw new AgentsApiError(
      error instanceof Error ? error.message : 'Profile summary request failed.',
    )
  } finally {
    window.clearTimeout(timeoutId)
  }
}
