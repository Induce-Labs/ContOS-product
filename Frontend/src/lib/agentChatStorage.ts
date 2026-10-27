import type { AgentType } from './agentsApi'

const STORAGE_PREFIX = 'contos_agents_chat'
const MAX_MESSAGES = 80
const MAX_SESSIONS = 30
const STORE_VERSION = 2 as const

export type StoredChatRole = 'assistant' | 'user'

/** The message a user tagged before sending. Excerpt is clipped plain text. */
export type ReplyTarget = {
  messageId: string
  role: StoredChatRole
  excerpt: string
}

/** The draft attached with Add to chat. Excerpt is the opening of that post. */
export type DraftPreview = {
  postId: string
  platform: 'linkedin' | 'instagram' | 'x'
  excerpt: string
}

export type StoredChatMessage = {
  id: string
  role: StoredChatRole
  content: string
  agentType?: AgentType
  output?: unknown
  taggedAvatarIds?: string[]
  taggedAvatarNames?: string[]
  /** Set on a refine reply so it is not extracted as another draft card. */
  proposalForPostId?: string
  replyTo?: ReplyTarget
  /** Set on the instruction that revises one attached draft. */
  draftPreview?: DraftPreview
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

/**
 * Persist only when the in-memory thread was loaded for this route project.
 * A project switch must not write the previous project's messages under the new id.
 */
export function canPersistChatForProject(
  boundProjectId: string | null | undefined,
  routeProjectId: string | null | undefined,
): boolean {
  if (!boundProjectId || !routeProjectId) return false
  return boundProjectId === routeProjectId
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function compactDraftPreview(value: DraftPreview | undefined): DraftPreview | undefined {
  if (!value) return undefined
  if (value.platform !== 'linkedin' && value.platform !== 'instagram' && value.platform !== 'x') {
    return undefined
  }
  if (typeof value.postId !== 'string' || value.postId.trim().length === 0 || value.postId.length > 80) {
    return undefined
  }
  if (typeof value.excerpt !== 'string') return undefined
  const excerpt = value.excerpt.trim().slice(0, 280)
  if (!excerpt) return undefined
  return { postId: value.postId.trim(), platform: value.platform, excerpt }
}

function compactReplyTo(value: ReplyTarget | undefined): ReplyTarget | undefined {
  if (!value) return undefined
  if (value.role !== 'user' && value.role !== 'assistant') return undefined
  if (typeof value.messageId !== 'string' || value.messageId.trim().length === 0) return undefined
  if (typeof value.excerpt !== 'string') return undefined
  const excerpt = value.excerpt.replace(/\s+/g, ' ').trim().slice(0, 140)
  if (!excerpt) return undefined
  return { messageId: value.messageId, role: value.role, excerpt }
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

export type ChatSyncChoice = {
  store: ChatStore
  /** Write `store` to Supabase. */
  uploadLocal: boolean
}

/** Union sessions from both browsers. The same session id keeps the newer copy. */
export function mergeChatStores(local: ChatStore, remote: ChatStore): ChatStore {
  const byId = new Map<string, ChatSession>()
  for (const session of [...remote.sessions, ...local.sessions]) {
    if (!sessionHasUserMessages(session.messages)) continue
    const existing = byId.get(session.id)
    const existingTs = existing ? new Date(existing.updatedAt).getTime() : Number.NEGATIVE_INFINITY
    const nextTs = new Date(session.updatedAt).getTime()
    if (!existing || (!Number.isNaN(nextTs) && nextTs >= existingTs)) {
      byId.set(session.id, session)
    }
  }

  const sessions = [...byId.values()]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_SESSIONS)

  if (sessions.length === 0) {
    return storeUpdatedAtMs(local) >= storeUpdatedAtMs(remote) ? local : remote
  }

  const newer = storeUpdatedAtMs(local) >= storeUpdatedAtMs(remote) ? local : remote
  const newerActive = getActiveSession(newer)
  if (!sessionHasUserMessages(newerActive.messages)) {
    return {
      version: STORE_VERSION,
      activeSessionId: newerActive.id,
      sessions: [newerActive, ...sessions.filter((session) => session.id !== newerActive.id)].slice(
        0,
        MAX_SESSIONS,
      ),
    }
  }

  const activeSessionId = sessions.some((session) => session.id === newer.activeSessionId)
    ? newer.activeSessionId
    : sessions[0].id

  return {
    version: STORE_VERSION,
    activeSessionId,
    sessions,
  }
}

/**
 * Supabase is the account copy. Sessions from this browser and the account
 * are kept together. A browser with no chats does not delete account history.
 */
export function resolveChatStoreSync(
  local: ChatStore,
  remote: { store: ChatStore; updatedAt: string } | null,
): ChatSyncChoice {
  if (!remote) {
    return { store: local, uploadLocal: storeHasUserMessages(local) }
  }

  const merged = mergeChatStores(local, remote.store)
  const changed =
    JSON.stringify(compactChatStore(merged)) !== JSON.stringify(compactChatStore(remote.store))
  return {
    store: merged,
    uploadLocal: changed && (storeHasUserMessages(merged) || storeHasUserMessages(local)),
  }
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
        if (message.proposalForPostId) compact.proposalForPostId = message.proposalForPostId
        const replyTo = compactReplyTo(message.replyTo)
        if (replyTo) compact.replyTo = replyTo
        const draftPreview = compactDraftPreview(message.draftPreview)
        if (draftPreview) compact.draftPreview = draftPreview
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

/** Read session list from local cache without creating a new empty store. */
export function peekLocalChatSessions(userId: string, projectId: string): ChatSession[] {
  if (typeof localStorage === 'undefined' || !userId || !projectId) {
    return []
  }
  try {
    const raw = localStorage.getItem(storageKey(userId, projectId))
    if (!raw) {
      return []
    }
    const stub: StoredChatMessage = { id: '_peek', role: 'assistant', content: '' }
    return listChatSessions(hydrateChatStore(JSON.parse(raw) as unknown, stub))
  } catch {
    return []
  }
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
 * Remove one session. If it was active, the newest remaining session becomes
 * active. If none remain, the store is a single empty thread.
 */
export function deleteChatSession(
  store: ChatStore,
  sessionId: string,
  welcomeMessage: StoredChatMessage,
): ChatStore {
  if (!store.sessions.some((session) => session.id === sessionId)) {
    throw new Error(`Chat session not found: ${sessionId}`)
  }

  const sessions = store.sessions.filter((session) => session.id !== sessionId)
  if (sessions.length === 0) {
    return createEmptyStore(welcomeMessage)
  }

  const activeSessionId =
    store.activeSessionId === sessionId
      ? listChatSessions({ ...store, sessions, activeSessionId: sessions[0].id })[0].id
      : store.activeSessionId

  return {
    version: STORE_VERSION,
    activeSessionId,
    sessions,
  }
}

export const CHAT_DELETE_EVENT = 'contos-chat-delete'
export const CHAT_DELETE_REVERT_EVENT = 'contos-chat-delete-revert'

export type ChatDeleteEventDetail = {
  projectId: string
  sessionId: string
  handled: boolean
  previous?: ChatStore
  next?: ChatStore
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
