import { getAccessToken as getAuthAccessToken } from './auth'
import { AgentsApiError, getAgentApiBaseUrl } from './agentsApi'
import { fetchAvatar } from './avatars'

export type ProfileSummarizeResponse = {
  avatar_id: string
  profile_summary: string
  status: string
  generated_at?: string | null
  cached?: boolean
  website_summary_status?: string | null
}

const TERMINAL_PROFILE_STATUSES = new Set(['completed', 'failed'])
const POLL_INTERVAL_MS = 2000

async function getAccessToken(): Promise<string> {
  try {
    return await getAuthAccessToken()
  } catch (error: unknown) {
    throw new AgentsApiError(
      error instanceof Error
        ? error.message
        : 'You must be signed in to generate a profile summary.',
    )
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timeoutId = window.setTimeout(() => resolve(), ms)
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeoutId)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

async function waitForProfileSummary(
  avatarId: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ProfileSummarizeResponse> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    const avatar = await fetchAvatar(avatarId)
    const status = String(avatar.profile_summary_status || '').toLowerCase()

    if (TERMINAL_PROFILE_STATUSES.has(status)) {
      if (status === 'failed') {
        const detail =
          typeof avatar.profile_summary_error === 'string' &&
          avatar.profile_summary_error.trim()
            ? avatar.profile_summary_error.trim()
            : 'Profile summary generation failed.'
        throw new AgentsApiError(detail, 502)
      }

      return {
        avatar_id: avatarId,
        profile_summary: avatar.profile_summary ?? '',
        status: 'completed',
        generated_at: avatar.profile_summary_generated_at,
        cached: false,
        website_summary_status: avatar.website_summary_status,
      }
    }

    await sleep(POLL_INTERVAL_MS, signal)
  }

  throw new AgentsApiError(
    `Profile summary timed out after ${Math.round(timeoutMs / 1000)}s.`,
  )
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

    // 202 queued — poll Supabase until profile_summary_status is terminal.
    if (response.status === 202 || payload.status === 'queued') {
      return await waitForProfileSummary(avatarId, timeoutMs, controller.signal)
    }

    // Backward-compatible sync response (should not happen after Celery cutover).
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
