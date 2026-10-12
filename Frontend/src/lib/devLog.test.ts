import { afterEach, describe, expect, it, vi } from 'vitest'

import { logDevError, userFacingMessage } from './devLog'
import { PostizApiError } from './postiz'

describe('logDevError', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('prints sanitized fields in development', () => {
    vi.stubEnv('DEV', true)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    logDevError('POST /api/postiz/posts', {
      method: 'POST',
      path: '/api/postiz/posts',
      status: 500,
      error:
        'failed Bearer secret-token pos_live_example redis://user:pass@redis:6379/0',
      authorization: 'Bearer hidden',
      body: '{"content":"secret post"}',
    })
    expect(errorSpy).toHaveBeenCalledOnce()
    const [label, details] = errorSpy.mock.calls[0] as [string, Record<string, unknown>]
    expect(label).toBe('[ContOS API Error] POST /api/postiz/posts')
    expect(details.method).toBe('POST')
    expect(details.path).toBe('/api/postiz/posts')
    expect(details.status).toBe(500)
    expect(details.error).not.toContain('pos_live_example')
    expect(details.error).not.toContain('secret-token')
    expect(details.error).not.toContain('redis://')
    expect(details).not.toHaveProperty('authorization')
    expect(details).not.toHaveProperty('body')
  })

  it('prints nothing outside development', () => {
    vi.stubEnv('DEV', false)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    logDevError('POST /api/postiz/posts', {
      method: 'POST',
      path: '/api/postiz/posts',
      status: 500,
      error: 'Postiz request failed',
    })
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe('userFacingMessage', () => {
  it('keeps a known reconnect message', () => {
    const error = new PostizApiError(
      'Postiz authorization is no longer valid; reconnect required.',
      401,
    )
    expect(userFacingMessage(error, 'Failed to save the post.')).toBe(
      'Postiz authorization is no longer valid; reconnect required.',
    )
  })

  it('hides server failures and unknown client errors', () => {
    expect(
      userFacingMessage(new PostizApiError('gateway down', 500), 'Failed to save the post.'),
    ).toBe('Failed to save the post.')
    expect(
      userFacingMessage(
        new PostizApiError('Postiz access token has an unexpected format.', 400),
        'Failed to save the post.',
      ),
    ).toBe('Failed to save the post.')
    expect(
      userFacingMessage(
        new PostizApiError('Postiz request failed with status 400: upstream exploded', 400),
        'Failed to save the post.',
      ),
    ).toBe('Failed to save the post.')
  })

  it('keeps frontend checks that have no HTTP status', () => {
    expect(
      userFacingMessage(new PostizApiError('Post content must not be empty.'), 'Failed to save the post.'),
    ).toBe('Post content must not be empty.')
  })

  it('hides wrapped server text once a numeric status is present', () => {
    const error = new Error('duplicate key value violates unique constraint') as Error & {
      statusCode: number
    }
    error.statusCode = 500
    expect(userFacingMessage(error, 'Failed to load dashboard')).toBe(
      'Failed to load dashboard',
    )
  })
})
