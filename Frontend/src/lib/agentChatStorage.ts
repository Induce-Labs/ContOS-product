import type { AgentType } from './agentsApi'

const STORAGE_PREFIX = 'contos_agents_chat'
const MAX_MESSAGES = 80
const MAX_SESSIONS = 30
const STORE_VERSION = 2 as const

export type StoredChatRole = 'assistant' | 'user'

export type StoredChatMessage = {
  id: string
  role: StoredChatRole
  content: string
  agentType?: AgentType
  output?: unknown
  taggedAvatarIds?: string[]
  taggedAvatarNames?: string[]
}

export type ChatSession = {
  id: string
  title: string
  updatedAt: string
  messages: StoredChatMessage[]
}

export type ChatStore = {
  version: typeof STORE_VERSION
  activeSessionId: string
  sessions: ChatSession[]
}

function storageKey(userId: string, projectId: string): string {
  return `${STORAGE_PREFIX}:${userId}:${projectId}`
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isStoredMessage(item: unknown): item is StoredChatMessage {
  if (!item || typeof item !== 'object') return false
  const row = item as StoredChatMessage
  return (
    typeof row.id === 'string' &&
    (row.role === 'user' || row.role === 'assistant') &&
    typeof row.content === 'string'
  )
}

function sanitizeMessages(messages: unknown): StoredChatMessage[] {
  if (!Array.isArray(messages)) return []
  return messages.filter(isStoredMessage).slice(-MAX_MESSAGES)
}

function sanitizeSession(raw: unknown): ChatSession | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as ChatSession
  if (typeof row.id !== 'string' || typeof row.updatedAt !== 'string') return null
  return {
    id: row.id,
    title: typeof row.title === 'string' && row.title.trim() ? row.title.trim() : 'Chat',
    updatedAt: row.updatedAt,
    messages: sanitizeMessages(row.messages),
  }
}

/** Title from the first user message, or a default label. */
export function titleFromMessages(messages: StoredChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === 'user' && message.content.trim())
  if (!firstUser) return 'New chat'
  const clipped = firstUser.content.trim().replace(/\s+/g, ' ')
  return clipped.length > 48 ? `${clipped.slice(0, 47)}…` : clipped
}

export function sessionHasUserMessages(messages: StoredChatMessage[]): boolean {
  return messages.some((message) => message.role === 'user' && message.content.trim())
}

/** True when any session in the store has a user message. */
export function storeHasUserMessages(store: ChatStore): boolean {
  return store.sessions.some((session) => sessionHasUserMessages(session.messages))
}

/**
 * Enumerate local agent chat cache entries for a user.
 * Returns `{ avatarId, store }` for each valid store blob.
 */
export function listLocalAgentChatStores(
  userId: string,
  welcomeMessage: StoredChatMessage,
): Array<{ avatarId: string; store: ChatStore }> {
  if (typeof localStorage === 'undefined' || !userId) return []
  const prefix = `${STORAGE_PREFIX}:${userId}:`
  const results: Array<{ avatarId: string; store: ChatStore }> = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key?.startsWith(prefix)) continue
    const avatarId = key.slice(prefix.length)
    if (!avatarId) continue
    const raw = localStorage.getItem(key)
    if (!raw) continue
    try {
      results.push({
        avatarId,
        store: hydrateChatStore(JSON.parse(raw) as unknown, welcomeMessage),
      })
    } catch {
      // Skip corrupt cache entries — remote remains source of truth.
    }
  }
  return results
}

export function createEmptyStore(welcomeMessage: StoredChatMessage): ChatStore {
  const id = newSessionId()
  const now = new Date().toISOString()
  return {
    version: STORE_VERSION,
    activeSessionId: id,
    sessions: [
      {
        id,
        title: 'New chat',
        updatedAt: now,
        messages: [welcomeMessage],
      },
    ],
  }
}

function migrateRaw(raw: unknown, welcomeMessage: StoredChatMessage): ChatStore {
  if (Array.isArray(raw)) {
    const messages = sanitizeMessages(raw)
    const id = newSessionId()
    const now = new Date().toISOString()
    return {
      version: STORE_VERSION,
      activeSessionId: id,
      sessions: [
        {
          id,
          title: titleFromMessages(messages),
          updatedAt: now,
          messages: messages.length > 0 ? messages : [welcomeMessage],
        },
      ],
    }
  }

  if (raw && typeof raw === 'object' && (raw as ChatStore).version === STORE_VERSION) {
    const store = raw as ChatStore
    const sessions = (Array.isArray(store.sessions) ? store.sessions : [])
      .map(sanitizeSession)
      .filter((session): session is ChatSession => session !== null)
      .slice(0, MAX_SESSIONS)

    if (sessions.length === 0) {
      return createEmptyStore(welcomeMessage)
    }

    const activeId =
      sessions.some((session) => session.id === store.activeSessionId)
        ? store.activeSessionId
        : sessions[0].id

    return {
      version: STORE_VERSION,
      activeSessionId: activeId,
      sessions,
    }
  }

  return createEmptyStore(welcomeMessage)
}

/** Sanitize unknown JSON (local or remote) into a ChatStore. */
export function hydrateChatStore(
  raw: unknown,
  welcomeMessage: StoredChatMessage,
): ChatStore {
  return migrateRaw(raw, welcomeMessage)
}

export function loadChatStore(
  userId: string,
  projectId: string,
  welcomeMessage: StoredChatMessage,
): ChatStore {
  if (typeof localStorage === 'undefined') {
    return createEmptyStore(welcomeMessage)
  }
  try {
    const raw = localStorage.getItem(storageKey(userId, projectId))
    if (!raw) {
      return createEmptyStore(welcomeMessage)
    }
    return hydrateChatStore(JSON.parse(raw) as unknown, welcomeMessage)
  } catch {
    return createEmptyStore(welcomeMessage)
  }
}

export function saveChatStore(userId: string, projectId: string, store: ChatStore): void {
  if (typeof localStorage === 'undefined') return
  try {
    const trimmed = compactChatStore(store)
    localStorage.setItem(storageKey(userId, projectId), JSON.stringify(trimmed))
  } catch {
    // Quota / private mode — chat still works in memory.
  }
}

/** Drop bulky optional fields and enforce session/message caps before persist. */
export function compactChatStore(store: ChatStore): ChatStore {
  return {
    version: STORE_VERSION,
    activeSessionId: store.activeSessionId,
    sessions: store.sessions.slice(0, MAX_SESSIONS).map((session) => ({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      messages: session.messages.slice(-MAX_MESSAGES).map((message) => {
        const compact: StoredChatMessage = {
          id: message.id,
          role: message.role,
          content: message.content,
        }
        if (message.agentType) compact.agentType = message.agentType
        if (message.taggedAvatarIds?.length) {
          compact.taggedAvatarIds = message.taggedAvatarIds
        }
        if (message.taggedAvatarNames?.length) {
          compact.taggedAvatarNames = message.taggedAvatarNames
        }
        // Keep structured agent payloads so Instagram/LinkedIn cards rehydrate after reload.
        if (message.output != null) {
          compact.output = message.output
        }
        return compact
      }),
    })),
  }
}

/** Newest session `updatedAt` as epoch ms (0 if none). */
export function storeUpdatedAtMs(store: ChatStore): number {
  let max = 0
  for (const session of store.sessions) {
    const ts = new Date(session.updatedAt).getTime()
    if (!Number.isNaN(ts) && ts > max) max = ts
  }
  return max
}

export function getActiveSession(store: ChatStore): ChatSession {
  const active = store.sessions.find((session) => session.id === store.activeSessionId)
  if (active) return active
  return store.sessions[0]
}

export function listChatSessions(store: ChatStore): ChatSession[] {
  return [...store.sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )
}

export function updateActiveSessionMessages(
  store: ChatStore,
  messages: StoredChatMessage[],
): ChatStore {
  const now = new Date().toISOString()
  return {
    ...store,
    sessions: store.sessions.map((session) =>
      session.id === store.activeSessionId
        ? {
            ...session,
            messages: messages.slice(-MAX_MESSAGES),
            title: titleFromMessages(messages),
            updatedAt: now,
          }
        : session,
    ),
  }
}

export function switchChatSession(store: ChatStore, sessionId: string): ChatStore {
  if (!store.sessions.some((session) => session.id === sessionId)) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }
  return { ...store, activeSessionId: sessionId }
}

/**
 * Start a fresh thread. If the active session has no user messages, reuse it
 * instead of stacking empty "New chat" entries.
 */
export function startNewChatSession(
  store: ChatStore,
  welcomeMessage: StoredChatMessage,
): ChatStore {
  const active = getActiveSession(store)
  if (!sessionHasUserMessages(active.messages)) {
    const now = new Date().toISOString()
    return {
      ...store,
      sessions: store.sessions.map((session) =>
        session.id === active.id
          ? {
              ...session,
              title: 'New chat',
              updatedAt: now,
              messages: [welcomeMessage],
            }
          : session,
      ),
    }
  }

  const id = newSessionId()
  const now = new Date().toISOString()
  const nextSession: ChatSession = {
    id,
    title: 'New chat',
    updatedAt: now,
    messages: [welcomeMessage],
  }

  return {
    version: STORE_VERSION,
    activeSessionId: id,
    sessions: [nextSession, ...store.sessions].slice(0, MAX_SESSIONS),
  }
}

/** Clear all ContOS agent chat threads for a user (call on sign-out). */
export function clearAgentChatsForUser(userId: string | null | undefined): void {
  if (typeof localStorage === 'undefined' || !userId) return
  const prefix = `${STORAGE_PREFIX}:${userId}:`
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix)) keysToRemove.push(key)
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key)
  }
}

/** @deprecated Prefer loadChatStore — kept for callers expecting a flat message list. */
export function loadAgentChat(userId: string, projectId: string): StoredChatMessage[] {
  const welcome: StoredChatMessage = {
    id: 'welcome-placeholder',
    role: 'assistant',
    content: '',
  }
  const store = loadChatStore(userId, projectId, welcome)
  return getActiveSession(store).messages
}

/** @deprecated Prefer saveChatStore with updateActiveSessionMessages. */
export function saveAgentChat(
  userId: string,
  projectId: string,
  messages: StoredChatMessage[],
): void {
  const welcome: StoredChatMessage = {
    id: 'welcome-placeholder',
    role: 'assistant',
    content: '',
  }
  const existing = loadChatStore(userId, projectId, welcome)
  saveChatStore(userId, projectId, updateActiveSessionMessages(existing, messages))
}
