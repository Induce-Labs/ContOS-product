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

export async function completeOAuthCallback(): Promise<void> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const errorDescription = url.searchParams.get('error_description')

  if (errorDescription) {
    throw new AuthServiceError(decodeURIComponent(errorDescription))
  }

  if (!code) {
    const { data, error } = await supabase.auth.getSession()

    if (error) {
      throw mapAuthError(error, 'Failed to read auth session after redirect')
    }

    if (!data.session) {
      throw new AuthServiceError(
        'No authorization code or session found after OAuth redirect',
      )
    }

    return
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    throw mapAuthError(error, 'Failed to complete OAuth sign in')
  }
}

const TOKEN_REFRESH_SKEW_MS = 60_000

/**
 * Return a usable access token for Backend/Agents API calls.
 *
 * Prefer `getUser()` (server-validated) then read the session token. Fall back
 * to `refreshSession()` when storage has a session but the JWT is no longer
 * accepted by Supabase Auth.
 */
export async function getAccessToken(): Promise<string> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (!userError && user) {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()

    if (sessionError) {
      throw mapAuthError(sessionError, 'Failed to read auth session')
    }

    if (session?.access_token) {
      const expiresAtMs = (session.expires_at ?? 0) * 1000
      if (expiresAtMs > Date.now() + TOKEN_REFRESH_SKEW_MS) {
        return session.access_token
      }
    }
  }

  const { data, error: refreshError } = await supabase.auth.refreshSession()

  if (refreshError) {
    throw mapAuthError(
      refreshError,
      'Your session expired. Sign out and sign in again to continue.',
    )
  }

  if (!data.session?.access_token) {
    throw new AuthServiceError(
      'You must be signed in to continue. Sign out and sign in again if this persists.',
    )
  }

  return data.session.access_token
}
