import { describe, expect, it } from 'vitest'
import {
  deleteChatSession,
  type ChatStore,
  type StoredChatMessage,
} from './agentChatStorage'

const welcome: StoredChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hello',
}

function session(id: string, updatedAt: string): ChatStore['sessions'][number] {
  return {
    id,
    title: id,
    updatedAt,
    messages: [{ id: `${id}-user`, role: 'user', content: id }],
  }
}

describe('deleteChatSession', () => {
  it('removes the session and keeps the active thread when another chat is deleted', () => {
    const store: ChatStore = {
      version: 2,
      activeSessionId: 'active',
      sessions: [session('active', '2026-09-02T00:00:00.000Z'), session('older', '2026-09-01T00:00:00.000Z')],
    }

    const next = deleteChatSession(store, 'older', welcome)

    expect(next.sessions.map((item) => item.id)).toEqual(['active'])
    expect(next.activeSessionId).toBe('active')
  })

  it('activates the newest remaining session when the open chat is deleted', () => {
    const store: ChatStore = {
      version: 2,
      activeSessionId: 'active',
      sessions: [
        session('active', '2026-09-03T00:00:00.000Z'),
        session('newer', '2026-09-04T00:00:00.000Z'),
        session('older', '2026-09-01T00:00:00.000Z'),
      ],
    }

    const next = deleteChatSession(store, 'active', welcome)

    expect(next.sessions.map((item) => item.id)).toEqual(['newer', 'older'])
    expect(next.activeSessionId).toBe('newer')
  })

  it('starts an empty thread when the last chat is deleted', () => {
    const store: ChatStore = {
      version: 2,
      activeSessionId: 'only',
      sessions: [session('only', '2026-09-01T00:00:00.000Z')],
    }

    const next = deleteChatSession(store, 'only', welcome)

    expect(next.sessions).toHaveLength(1)
    expect(next.sessions[0]?.id).not.toBe('only')
    expect(next.sessions[0]?.messages).toEqual([welcome])
    expect(next.activeSessionId).toBe(next.sessions[0]?.id)
  })

  it('throws when the session id is not in the store', () => {
    const store: ChatStore = {
      version: 2,
      activeSessionId: 'active',
      sessions: [session('active', '2026-09-01T00:00:00.000Z')],
    }

    expect(() => deleteChatSession(store, 'missing', welcome)).toThrow(
      'Chat session not found: missing',
    )
  })
})
