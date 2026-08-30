import { supabase } from './supabase'
import type { Json } from '../types/database'
import {
  compactChatStore,
  hydrateChatStore,
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
