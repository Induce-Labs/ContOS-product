import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  clearAgentChatsForUser,
} from '../lib/agentChatStorage'
import { flushLocalAgentChatsToRemote } from '../lib/agentChatRemote'
import { validateStoredSessionOrRedirectToSignUp } from '../lib/auth'
import { logDevError, remoteStatusCode } from '../lib/devLog'
import { supabase } from '../lib/supabase'
import { AuthContext, type AuthContextValue } from './auth-context'

type AuthProviderProps = {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<AuthContextValue['session']>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true
    const pathname = window.location.pathname
    const isAuthCallbackRoute =
      pathname === '/auth/callback' || pathname === '/auth/postiz/callback'

    async function initializeSession() {
      try {
        // Avoid getUser() racing OAuth PKCE exchange on callback routes.
        if (isAuthCallbackRoute) {
          const {
            data: { session: nextSession },
            error,
          } = await supabase.auth.getSession()

          if (!isMounted) {
            return
          }

          if (error) {
            setSession(null)
            setIsLoading(false)
            return
          }

          setSession(nextSession)
          setIsLoading(false)
          return
        }

        const nextSession = await validateStoredSessionOrRedirectToSignUp()

        if (!isMounted) {
          return
        }

        setSession(nextSession)
        setIsLoading(false)
      } catch (error) {
        if (!isMounted) {
          return
        }

        // Redirect-to-signup throws AuthServiceError after navigation starts.
        setSession(null)
        setIsLoading(false)
        if (
          error instanceof Error &&
          error.name !== 'AuthServiceError'
        ) {
          logDevError('auth session init', { error: error.message })
          const failed = new Error('Failed to initialize auth session.', { cause: error })
          Object.assign(failed, { statusCode: remoteStatusCode(error) })
          throw failed
        }
      }
    }

    void initializeSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async (options?: { force?: boolean }) => {
    const userId = session?.user?.id
    const force = options?.force === true

    // Persist chats to Supabase before clearing the local cache so history
    // survives logout → login on this (and other) devices.
    if (userId && !force) {
      try {
        await flushLocalAgentChatsToRemote(userId)
      } catch (error) {
        logDevError('sign out chat flush', {
          error: error instanceof Error ? error.message : String(error),
        })
        throw new Error(
          'Sign out aborted: failed to save chat history. Stay signed in and try again.',
          { cause: error },
        )
      }
    }

    const { error } = await supabase.auth.signOut(
      force ? { scope: 'local' } : undefined,
    )

    if (error) {
      // Last-resort local clear when the auth server also rejects the session.
      const { error: localError } = await supabase.auth.signOut({ scope: 'local' })
      if (localError) {
        logDevError('auth sign out', {
          error: error.message,
          status: typeof error.status === 'number' ? error.status : 500,
        })
        const failed = new Error('Sign out failed.', { cause: error })
        Object.assign(failed, {
          statusCode: typeof error.status === 'number' ? error.status : 500,
        })
        throw failed
      }
    }

    clearAgentChatsForUser(userId)
  }, [session?.user?.id])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      signOut,
    }),
    [session, isLoading, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
