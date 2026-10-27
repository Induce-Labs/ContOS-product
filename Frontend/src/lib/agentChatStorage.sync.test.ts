import { describe, expect, it } from 'vitest'
import {
  resolveChatStoreSync,
  type ChatStore,
  type StoredChatMessage,
} from './agentChatStorage'

const welcome: StoredChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hello',
}

function store(id: string, updatedAt: string, withUser: boolean): ChatStore {
  return {
    version: 2,
    activeSessionId: id,
    sessions: [
      {
        id,
        title: id,
        updatedAt,
        messages: withUser
          ? [{ id: `${id}-user`, role: 'user', content: id }]
          : [welcome],
      },
    ],
  }
}

describe('resolveChatStoreSync', () => {
  it('uploads local chats when the account has no row', () => {
    const local = store('local', '2026-10-27T10:00:00.000Z', true)
    const choice = resolveChatStoreSync(local, null)
    expect(choice.uploadLocal).toBe(true)
    expect(choice.store.sessions.map((session) => session.id)).toEqual(['local'])
  })

  it('keeps account history when this browser only has a new chat', () => {
    const local = store('local', '2026-10-27T12:00:00.000Z', false)
    const remote = store('remote', '2026-10-27T09:00:00.000Z', true)
    const choice = resolveChatStoreSync(local, {
      store: remote,
      updatedAt: '2026-10-27T12:00:00.000Z',
    })
    expect(choice.store.sessions.map((session) => session.id)).toEqual(['local', 'remote'])
    expect(choice.uploadLocal).toBe(true)
  })

  it('keeps both browsers when each has its own chat', () => {
    const local = store('from-brave', '2026-10-27T09:00:00.000Z', true)
    const remote = store('from-chrome', '2026-10-27T12:00:00.000Z', true)
    const choice = resolveChatStoreSync(local, {
      store: remote,
      updatedAt: remote.sessions[0].updatedAt,
    })
    expect(choice.store.sessions.map((session) => session.id)).toEqual(['from-chrome', 'from-brave'])
    expect(choice.uploadLocal).toBe(true)
  })

  it('does not upload when this browser already matches the account', () => {
    const same = store('shared', '2026-10-27T09:00:00.000Z', true)
    const choice = resolveChatStoreSync(same, {
      store: same,
      updatedAt: same.sessions[0].updatedAt,
    })
    expect(choice.uploadLocal).toBe(false)
    expect(choice.store.activeSessionId).toBe('shared')
  })
})
