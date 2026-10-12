import { describe, expect, it } from 'vitest'
import {
  buildPostizAvatarSearch,
  buildPostizClaimBody,
  buildPostizCreateBody,
  postizContentLength,
} from './postiz'
import {
  addXThreadEntry,
  createXThreadDraft,
  moveXThreadEntry,
  removeXThreadEntry,
} from './postizThread'

const AVATAR_ID = '11111111-1111-1111-1111-111111111111'

describe('postiz request builders', () => {
  it('adds platform=x and the avatar id on connect, status, and disconnect search', () => {
    const search = buildPostizAvatarSearch(AVATAR_ID, 'x')
    expect(search.get('avatar_id')).toBe(AVATAR_ID)
    expect(search.get('platform')).toBe('x')
  })

  it('omits platform for LinkedIn search and claim', () => {
    const search = buildPostizAvatarSearch(AVATAR_ID)
    expect(search.get('avatar_id')).toBe(AVATAR_ID)
    expect(search.has('platform')).toBe(false)
    expect(buildPostizClaimBody(AVATAR_ID, 'li-1')).toEqual({
      avatar_id: AVATAR_ID,
      integration_id: 'li-1',
    })
  })

  it('includes platform x on claim and create', () => {
    expect(buildPostizClaimBody(AVATAR_ID, 'x-1', 'x')).toEqual({
      avatar_id: AVATAR_ID,
      integration_id: 'x-1',
      platform: 'x',
    })
    const body = buildPostizCreateBody({
      avatarId: AVATAR_ID,
      type: 'schedule',
      content: 'hello',
      publishDate: '2026-09-25T10:00:00.000Z',
      platform: 'x',
    })
    expect(body.platform).toBe('x')
    expect(body.avatar_id).toBe(AVATAR_ID)
    expect(body.type).toBe('schedule')
  })

  it('omits platform on LinkedIn create', () => {
    const body = buildPostizCreateBody({
      avatarId: AVATAR_ID,
      type: 'now',
      content: 'hello',
      publishDate: '2026-09-25T10:00:00.000Z',
    })
    expect(body).not.toHaveProperty('platform')
    expect(body.avatar_id).toBe(AVATAR_ID)
  })

  it('counts characters as the string length', () => {
    expect(postizContentLength('')).toBe(0)
    expect(postizContentLength('hi')).toBe(2)
    expect(postizContentLength('a'.repeat(281))).toBe(281)
  })

  it('keeps a single X entry body unchanged until posts are passed', () => {
    const single = buildPostizCreateBody({
      avatarId: AVATAR_ID,
      type: 'now',
      content: 'Hello X',
      publishDate: '2026-09-25T10:00:00.000Z',
      platform: 'x',
    })
    expect(single).not.toHaveProperty('posts')
    expect(single.platform).toBe('x')
    expect(single.content).toBe('Hello X')
  })

  it('adds, removes, and reorders X thread entries into the request body', () => {
    const first = createXThreadDraft('First')
    const added = addXThreadEntry([first])
    expect(added).toHaveLength(2)
    expect(added[0].content).toBe('First')
    expect(postizContentLength(added[0].content)).toBe(5)

    const filled = [
      added[0],
      { ...added[1], content: 'Second' },
      { ...createXThreadDraft(), content: 'Third' },
    ]
    expect(filled.map((entry) => postizContentLength(entry.content))).toEqual([5, 6, 5])

    const withoutThird = removeXThreadEntry(filled, 2)
    expect(withoutThird.map((entry) => entry.content)).toEqual(['First', 'Second'])
    expect(removeXThreadEntry([first], 0)).toHaveLength(1)

    const reordered = moveXThreadEntry(filled, 2, -1)
    expect(reordered.map((entry) => entry.content)).toEqual(['First', 'Third', 'Second'])
    const movedAgain = moveXThreadEntry(reordered, 0, 1)
    expect(movedAgain.map((entry) => entry.content)).toEqual(['Third', 'First', 'Second'])

    const body = buildPostizCreateBody({
      avatarId: AVATAR_ID,
      type: 'schedule',
      content: movedAgain[0].content,
      publishDate: '2026-09-25T10:00:00.000Z',
      platform: 'x',
      posts: movedAgain.map((entry) => ({ content: entry.content })),
    })
    expect(body.platform).toBe('x')
    expect(body.content).toBe('Third')
    expect(body.posts).toEqual([
      { content: 'Third' },
      { content: 'First' },
      { content: 'Second' },
    ])

    const linkedin = buildPostizCreateBody({
      avatarId: AVATAR_ID,
      type: 'now',
      content: 'Hello',
      publishDate: '2026-09-25T10:00:00.000Z',
      posts: [{ content: 'Hello' }],
    })
    expect(linkedin).not.toHaveProperty('posts')
    expect(linkedin).not.toHaveProperty('platform')
  })
})
