import { describe, expect, it } from 'vitest'
import {
  buildPostizAvatarSearch,
  buildPostizClaimBody,
  buildPostizCreateBody,
  postizContentLength,
} from './postiz'

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
})
