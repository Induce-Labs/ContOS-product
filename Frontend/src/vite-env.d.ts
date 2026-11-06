/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_API_BASE_URL: string
  readonly VITE_AGENT_API_BASE_URL: string
  readonly VITE_SENTRY_DSN?: string
  readonly VITE_SENTRY_ENVIRONMENT?: string
  /** Opt-in ContOS flow browser console; never set in production. */
  readonly VITE_CONTOS_FLOW_CONSOLE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
