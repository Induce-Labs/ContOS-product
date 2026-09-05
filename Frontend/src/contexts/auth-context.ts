import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type AuthSignOutOptions = {
  /** Skip remote chat flush and still clear the local session (escape hatch for expired JWT). */
  force?: boolean
}

export type AuthContextValue = {
  session: Session | null
  user: User | null
  isLoading: boolean
  signOut: (options?: AuthSignOutOptions) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
