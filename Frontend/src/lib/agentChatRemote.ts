import { supabase } from './supabase'
import type { Json } from '../types/database'
import {
  compactChatStore,
  hydrateChatStore,
  listLocalAgentChatStores,
  storeHasUserMessages,
  type ChatStore,
  type StoredChatMessage,
} from './agentChatStorage'

export class AgentChatRemoteError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'AgentChatRemoteError'
    if (cause instanceof Error) {
      this.cause = cause
    }
  }
}

export type RemoteChatStoreRow = {
  store: ChatStore
  updatedAt: string
}

/**
 * Load the JSONB chat blob for one avatar. Returns null when no row exists.
 * Raises AgentChatRemoteError on query failure (e.g. missing table / RLS).
 */
export async function fetchRemoteChatStore(
  userId: string,
  avatarId: string,
  welcomeMessage: StoredChatMessage,
): Promise<RemoteChatStoreRow | null> {
  const { data, error } = await supabase
    .from('agent_chat_stores')
    .select('store, updated_at')
    .eq('user_id', userId)
    .eq('avatar_id', avatarId)
    .maybeSingle()

  if (error) {
    throw new AgentChatRemoteError(
      `Failed to load chat history from Supabase (user_id=${userId}, avatar_id=${avatarId}): ${error.message}`,
      error,
    )
  }

  if (!data) return null

  return {
    store: hydrateChatStore(data.store, welcomeMessage),
    updatedAt: data.updated_at,
  }
}

/**
 * Upsert the compact chat store for one avatar (one row — space-efficient).
 */
export async function upsertRemoteChatStore(
  userId: string,
  avatarId: string,
  store: ChatStore,
): Promise<void> {
  const payload = compactChatStore(store)
  const { error } = await supabase.from('agent_chat_stores').upsert(
    {
      user_id: userId,
      avatar_id: avatarId,
      store: payload as unknown as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,avatar_id' },
  )

  if (error) {
    throw new AgentChatRemoteError(
      `Failed to save chat history to Supabase (user_id=${userId}, avatar_id=${avatarId}): ${error.message}`,
      error,
    )
  }
}

/**
 * Push every local agent chat store for this user to Supabase before sign-out.
 * Skips empty welcome-only stores. Raises on the first failed upsert.
 */
export async function flushLocalAgentChatsToRemote(userId: string): Promise<void> {
  const welcome: StoredChatMessage = {
    id: 'welcome-placeholder',
    role: 'assistant',
    content: '',
  }
  const localStores = listLocalAgentChatStores(userId, welcome)
  for (const entry of localStores) {
    if (!storeHasUserMessages(entry.store)) continue
    await upsertRemoteChatStore(userId, entry.avatarId, entry.store)
  }
}
