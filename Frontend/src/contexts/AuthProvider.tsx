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

    async function initializeSession() {
      const { data, error } = await supabase.auth.getSession()

      if (!isMounted) {
        return
      }

      if (error) {
        throw new Error(`Failed to initialize auth session: ${error.message}`)
      }

      setSession(data.session)
      setIsLoading(false)
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

  const signOut = useCallback(async () => {
    const userId = session?.user?.id

    // Persist chats to Supabase before clearing the local cache so history
    // survives logout → login on this (and other) devices.
    if (userId) {
      try {
        await flushLocalAgentChatsToRemote(userId)
      } catch (error) {
        throw new Error(
          `Sign out aborted: failed to save chat history (${
            error instanceof Error ? error.message : String(error)
          }). Stay signed in and try again.`,
          { cause: error instanceof Error ? error : undefined },
        )
      }
    }

    const { error } = await supabase.auth.signOut()

    if (error) {
      throw new Error(`Sign out failed: ${error.message}`)
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
