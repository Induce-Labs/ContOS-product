import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

function requireEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Copy Frontend/.env.example to Frontend/.env.local and set the value.`,
    )
  }
  return value
}

const supabaseUrl = requireEnv('VITE_SUPABASE_URL')
const supabaseAnonKey = requireEnv('VITE_SUPABASE_ANON_KEY')

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey)

export function getApiBaseUrl(): string {
  return requireEnv('VITE_API_BASE_URL')
}
