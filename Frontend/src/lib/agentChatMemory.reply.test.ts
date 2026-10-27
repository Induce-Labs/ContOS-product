import { describe, expect, it } from 'vitest'
import { compactChatStore, type ChatStore } from './agentChatStorage'
import { buildChatHistoryForInvoke } from './agentChatMemory'

describe('reply history', () => {
  it('prefixes a reply and leaves a normal turn unchanged', () => {
    const history = buildChatHistoryForInvoke([
      { role: 'assistant', content: 'Original angle' },
      {
        role: 'user',
        content: 'Make it shorter',
        replyTo: { messageId: 'a', role: 'assistant', excerpt: 'Original angle' },
      },
      { role: 'user', content: 'And another thought' },
    ])

    expect(history.map((turn) => turn.content)).toEqual([
      'Original angle',
      'Replying to the assistant: "Original angle"\n\nMake it shorter',
      'And another thought',
    ])
  })

  it('keeps replyTo when the chat store is saved', () => {
    const store: ChatStore = {
      version: 2,
      activeSessionId: 's',
      sessions: [
        {
          id: 's',
          title: 'Chat',
          updatedAt: '2026-10-27T00:00:00.000Z',
          messages: [
            {
              id: 'u',
              role: 'user',
              content: 'Shorter',
              replyTo: {
                messageId: 'a',
                role: 'assistant',
                excerpt: `${'x'.repeat(180)} trailing`,
              },
            },
          ],
        },
      ],
    }

    const saved = compactChatStore(store)
    expect(saved.sessions[0]?.messages[0]?.replyTo).toEqual({
      messageId: 'a',
      role: 'assistant',
      excerpt: 'x'.repeat(140),
    })
    expect(saved.sessions[0]?.messages[0]?.content).toBe('Shorter')
  })

  it('keeps the attached draft preview when the chat store is saved', () => {
    const store: ChatStore = {
      version: 2,
      activeSessionId: 's',
      sessions: [
        {
          id: 's',
          title: 'Chat',
          updatedAt: '2026-10-27T00:00:00.000Z',
          messages: [
            {
              id: 'u',
              role: 'user',
              content: 'Make this more formal',
              draftPreview: {
                postId: 'post-1',
                platform: 'linkedin',
                excerpt: 'Not because the work was bad.',
              },
            },
          ],
        },
      ],
    }

    expect(compactChatStore(store).sessions[0]?.messages[0]?.draftPreview).toEqual({
      postId: 'post-1',
      platform: 'linkedin',
      excerpt: 'Not because the work was bad.',
    })
  })
})
