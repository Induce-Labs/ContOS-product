import { getAccessToken } from './auth'
import { getApiBaseUrl } from './supabase'

export class PostizApiError extends Error {
  readonly statusCode: number | null

  constructor(message: string, statusCode: number | null = null) {
    super(message)
    this.name = 'PostizApiError'
    this.statusCode = statusCode
  }
}

export type PostizConnectResponse = {
  authorization_url: string
  flow: string
}

export type PostizCallbackResponse = {
  success: boolean
  authorization_url: string
}

export type PostizChannel = {
  id: string
  provider: string
  name: string
}

export type PostizStatusResponse = {
  connected: boolean
  channels: PostizChannel[]
}

function parseChannels(value: unknown): PostizChannel[] {
  if (!Array.isArray(value)) {
    throw new PostizApiError('Postiz status returned an unexpected channels field.')
  }

  return value.map((item, index) => {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof (item as PostizChannel).id !== 'string' ||
      typeof (item as PostizChannel).provider !== 'string' ||
      typeof (item as PostizChannel).name !== 'string'
    ) {
      throw new PostizApiError(
        `Postiz status returned an unexpected channel at index ${index}.`,
      )
    }
    return {
      id: (item as PostizChannel).id,
      provider: (item as PostizChannel).provider,
      name: (item as PostizChannel).name,
    }
  })
}

async function requireAccessToken(): Promise<string> {
  try {
    return await getAccessToken()
  } catch (error: unknown) {
    throw new PostizApiError(
      error instanceof Error ? error.message : 'You must be signed in to continue.',
    )
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  const bodyText = await response.text()
  if (!bodyText) {
    return `Request failed with status ${response.status}`
  }

  try {
    const parsed: unknown = JSON.parse(bodyText)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'detail' in parsed &&
      typeof (parsed as { detail: unknown }).detail === 'string'
    ) {
      return (parsed as { detail: string }).detail
    }
  } catch {
    // Use raw text below.
  }

  return bodyText
}

export async function getPostizStatus(): Promise<PostizStatusResponse> {
  const accessToken = await requireAccessToken()
  const response = await fetch(`${getApiBaseUrl()}/api/postiz/status`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new PostizApiError(await readErrorDetail(response), response.status)
  }

  const data: unknown = await response.json()
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as PostizStatusResponse).connected !== 'boolean'
  ) {
    throw new PostizApiError('Postiz status returned an unexpected response body.')
  }

  return {
    connected: (data as PostizStatusResponse).connected,
    channels: parseChannels((data as { channels?: unknown }).channels),
  }
}

export async function startPostizConnect(): Promise<PostizConnectResponse> {
  const accessToken = await requireAccessToken()
  const response = await fetch(`${getApiBaseUrl()}/api/postiz/connect`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new PostizApiError(await readErrorDetail(response), response.status)
  }

  const data: unknown = await response.json()
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof (data as PostizConnectResponse).authorization_url !== 'string' ||
    typeof (data as PostizConnectResponse).flow !== 'string'
  ) {
    throw new PostizApiError('Postiz connect returned an unexpected response body.')
  }

  return {
    authorization_url: (data as PostizConnectResponse).authorization_url,
    flow: (data as PostizConnectResponse).flow,
  }
}

export async function completePostizOAuthCallback(
  code: string,
  state: string,
): Promise<PostizCallbackResponse> {
  const accessToken = await requireAccessToken()
  const response = await fetch(`${getApiBaseUrl()}/api/postiz/oauth/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ code, state }),
  })

  if (!response.ok) {
    throw new PostizApiError(await readErrorDetail(response), response.status)
  }

  const data: unknown = await response.json()
  if (
    typeof data !== 'object' ||
    data === null ||
    (data as PostizCallbackResponse).success !== true ||
    typeof (data as PostizCallbackResponse).authorization_url !== 'string'
  ) {
    throw new PostizApiError('Postiz OAuth callback returned an unexpected response body.')
  }

  return {
    success: true,
    authorization_url: (data as PostizCallbackResponse).authorization_url,
  }
}
