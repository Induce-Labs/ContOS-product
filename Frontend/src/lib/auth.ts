import type { AuthError, Provider } from '@supabase/supabase-js'
import { supabase } from './supabase'

export class AuthServiceError extends Error {
  readonly cause: AuthError | null

  constructor(message: string, cause: AuthError | null = null) {
    super(message)
    this.name = 'AuthServiceError'
    this.cause = cause
  }
}

function mapAuthError(error: AuthError, fallbackMessage: string): AuthServiceError {
  return new AuthServiceError(error.message || fallbackMessage, error)
}

export function getAuthRedirectUrl(): string {
  return `${window.location.origin}/auth/callback`
}

const SIGNUP_INVALID_SESSION_PATH = '/signup?session=invalid'

/** True when Auth/DB errors mean the account was deleted or the refresh token is dead. */
export function isInvalidOrDeletedUserError(error: {
  message?: string
  code?: string
  status?: number
} | null | undefined): boolean {
  if (!error) {
    return false
  }

  const message = (error.message ?? '').toLowerCase()
  const code = (error.code ?? '').toLowerCase()
  const status = error.status

  return (
    status === 401 ||
    status === 403 ||
    code === '23503' ||
    code === 'user_not_found' ||
    message.includes('invalid refresh token') ||
    message.includes('refresh token not found') ||
    message.includes('user not found') ||
    message.includes('user from sub claim') ||
    message.includes('session from session_id claim') ||
    message.includes('foreign key') ||
    message.includes('user_profiles_user_id_fkey')
  )
}

/**
 * Clear the ghost local session (e.g. after the Auth user was deleted in Supabase)
 * and send the browser to sign-up.
 */
export async function clearInvalidSessionAndRedirectToSignUp(
  reason = 'Your account is no longer available. Please sign up again.',
): Promise<never> {
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Local clear is best-effort.
  }

  if (
    typeof window !== 'undefined' &&
    !window.location.pathname.startsWith('/signup') &&
    !window.location.pathname.startsWith('/login')
  ) {
    window.location.replace(SIGNUP_INVALID_SESSION_PATH)
  }

  throw new AuthServiceError(reason)
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    throw mapAuthError(error, 'Sign in failed')
  }
}

export type SignUpResult =
  | { kind: 'session_created' }
  | { kind: 'email_confirmation_required' }

export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<SignUpResult> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
    },
  })

  if (error) {
    throw mapAuthError(error, 'Sign up failed')
  }

  if (data.session) {
    return { kind: 'session_created' }
  }

  return { kind: 'email_confirmation_required' }
}

export async function signInWithOAuthProvider(provider: Provider): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: getAuthRedirectUrl(),
    },
  })

  if (error) {
    throw mapAuthError(error, `Sign in with ${provider} failed`)
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut()

  if (error) {
    throw mapAuthError(error, 'Sign out failed')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function isRecoverableCodeExchangeError(error: AuthError): boolean {
  const message = (error.message ?? '').toLowerCase()
  const code = (error.code ?? '').toLowerCase()
  return (
    code === 'flow_state_not_found' ||
    message.includes('already been used') ||
    message.includes('code verifier') ||
    message.includes('pkce') ||
    message.includes('invalid flow state') ||
    message.includes('auth code not found') ||
    message.includes('both auth code and code verifier')
  )
}

async function waitForSession(attempts = 5, delayMs = 400) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data, error } = await supabase.auth.getSession()

    if (error) {
      throw mapAuthError(error, 'Failed to read auth session after redirect')
    }

    if (data.session) {
      return data.session
    }

    if (attempt < attempts - 1) {
      await sleep(delayMs)
    }
  }

  return null
}

export async function completeOAuthCallback(): Promise<void> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const oauthError = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  if (oauthError || errorDescription) {
    throw new AuthServiceError(
      decodeURIComponent(errorDescription ?? oauthError ?? 'OAuth sign in was denied'),
    )
  }

  // detectSessionInUrl may already be exchanging ?code=; wait before a manual exchange
  // to avoid racing the auth lock / consuming the one-time code twice.
  if (code) {
    const existing = await waitForSession(6, 300)
    if (existing) {
      return
    }

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      const afterExchange = await waitForSession(3, 250)
      if (afterExchange) {
        return
      }
      if (isRecoverableCodeExchangeError(error)) {
        throw new AuthServiceError(
          'OAuth authorization code was already used and no session is available. Please try signing in again.',
          error,
        )
      }
      throw mapAuthError(error, 'Failed to complete OAuth sign in')
    }

    return
  }

  const session = await waitForSession()
  if (!session) {
    throw new AuthServiceError(
      'No authorization code or session found after OAuth redirect',
    )
  }
}

const TOKEN_REFRESH_SKEW_MS = 60_000

/**
 * Return a fresh session from storage, refreshing when the access token is
 * missing or near expiry. If the Auth user was deleted (or the refresh token
 * is dead), clears local storage and redirects to sign-up.
 */
async function ensureFreshSession() {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) {
    if (isInvalidOrDeletedUserError(sessionError)) {
      return await clearInvalidSessionAndRedirectToSignUp(sessionError.message)
    }
    throw mapAuthError(sessionError, 'Failed to read auth session')
  }

  if (session?.access_token && session.user) {
    const expiresAtMs = (session.expires_at ?? 0) * 1000
    if (expiresAtMs > Date.now() + TOKEN_REFRESH_SKEW_MS) {
      return session
    }
  }

  const { data, error: refreshError } = await supabase.auth.refreshSession()

  if (refreshError || !data.session?.access_token || !data.session.user) {
    return await clearInvalidSessionAndRedirectToSignUp(
      refreshError?.message ??
        'Your session is no longer valid. Please sign up again.',
    )
  }

  return data.session
}

/**
 * Authenticated user id for client-side writes (onboarding, avatars, etc.).
 */
export async function requireAuthenticatedUserId(): Promise<string> {
  const session = await ensureFreshSession()
  return session.user.id
}

/**
 * Return a usable access token for Backend/Agents API calls.
 */
export async function getAccessToken(): Promise<string> {
  const session = await ensureFreshSession()
  return session.access_token
}

/**
 * Confirm the stored session still maps to a living Auth user.
 * Used on app boot — catches deleted-in-dashboard accounts with a leftover JWT.
 */
export async function validateStoredSessionOrRedirectToSignUp() {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()

  if (sessionError) {
    return await clearInvalidSessionAndRedirectToSignUp(sessionError.message)
  }

  if (!session) {
    return null
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (!userError && user) {
    return session
  }

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession()

  if (refreshError || !refreshed.session?.user) {
    return await clearInvalidSessionAndRedirectToSignUp(
      userError?.message ??
        refreshError?.message ??
        'Your account is no longer available. Please sign up again.',
    )
  }

  return refreshed.session
}
