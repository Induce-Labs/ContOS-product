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
  const raw = requireEnv('VITE_API_BASE_URL').trim().replace(/\/+$/, '')

  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)

    // Railway (and most hosts) redirect http→https with 301, which turns POST into GET → 405.
    if (
      url.protocol === 'http:' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1'
    ) {
      url.protocol = 'https:'
    }

    return url.origin
  } catch {
    throw new Error(
      `Invalid VITE_API_BASE_URL: "${raw}". Use a full URL like https://your-app.up.railway.app`,
    )
  }
}
