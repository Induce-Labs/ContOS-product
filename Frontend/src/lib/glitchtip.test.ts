import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
  init: vi.fn(),
  reactErrorHandler: () => () => undefined,
}))

import * as Sentry from '@sentry/react'
import { PostizApiError } from './postiz'
import { redactText, scrubGlitchtipEvent } from './glitchtip'

describe('glitchtip scrubbing', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.mocked(Sentry.captureException).mockClear()
  })

  it.each([400, 401, 403, 404, 409, 429])(
    'does not report expected status %s',
    (statusCode) => {
      vi.stubEnv('VITE_SENTRY_DSN', 'https://public@glitchtip.example/1')
      new PostizApiError('user facing message', statusCode)
      expect(Sentry.captureException).not.toHaveBeenCalled()
    },
  )

  it('reports an unexpected 5xx failure', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@glitchtip.example/1')
    const error = new PostizApiError('gateway down', 502)
    expect(Sentry.captureException).toHaveBeenCalledWith(error)
  })

  it('does not report when the DSN is absent', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    new PostizApiError('gateway down', 503)
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })

  it('beforeSend removes headers, cookies, and bodies', () => {
    const event = scrubGlitchtipEvent({
      request: {
        url: 'https://app.example/calendar',
        headers: { Authorization: 'Bearer header-token', Cookie: 'sid=1' },
        cookies: { sid: '1' },
        data: { content: 'post text' },
        body: 'uploaded-file',
      },
    })
    expect(event).not.toBeNull()
    expect(event?.request?.headers).toBeUndefined()
    expect(event?.request?.cookies).toBeUndefined()
    expect(event?.request?.data).toBeUndefined()
    expect(event?.request?.body).toBeUndefined()
    expect(JSON.stringify(event)).not.toContain('header-token')
    expect(JSON.stringify(event)).not.toContain('post text')
    expect(JSON.stringify(event)).not.toContain('uploaded-file')
  })

  it('beforeSend removes sensitive URL parameters', () => {
    const event = scrubGlitchtipEvent({
      request: {
        url: 'https://app.example/callback?access_token=access-1&refresh_token=refresh-1&client_secret=secret-1&api_key=key-1&token=tok-1&secret=sec-1&password=pw-1&code=code-1&avatar_id=avatar-1',
      },
    })
    const rendered = JSON.stringify(event)
    expect(rendered).not.toContain('access-1')
    expect(rendered).not.toContain('refresh-1')
    expect(rendered).not.toContain('secret-1')
    expect(rendered).not.toContain('key-1')
    expect(rendered).not.toContain('tok-1')
    expect(rendered).not.toContain('sec-1')
    expect(rendered).not.toContain('pw-1')
    expect(rendered).not.toContain('code-1')
    expect(rendered).toContain('avatar-1')
  })

  it('beforeSend removes pos tokens and oauth secrets', () => {
    const event = scrubGlitchtipEvent({
      exception: {
        values: [
          {
            value:
              'Authorization Bearer bearer-token pos_live_token client_secret=oauth-secret CONTOS_PROVISION_SECRET=provision-value-zzz POSTIZ_TOKEN_ENCRYPTION_KEY=fernet-key-zzz redis://user:pass@redis:6379/0',
          },
        ],
      },
    })
    const rendered = JSON.stringify(event)
    expect(rendered).not.toContain('bearer-token')
    expect(rendered).not.toContain('pos_live_token')
    expect(rendered).not.toContain('oauth-secret')
    expect(rendered).not.toContain('provision-value-zzz')
    expect(rendered).not.toContain('fernet-key-zzz')
    expect(rendered).not.toContain('redis://user:pass@redis:6379/0')
  })

  it('drops expected 4xx events and keeps 5xx events', () => {
    expect(scrubGlitchtipEvent({ contexts: { response: { status_code: 404 } } })).toBeNull()
    const kept = scrubGlitchtipEvent({
      contexts: { response: { status_code: 500 } },
      message: 'server failed',
    })
    expect(kept?.message).toBe('server failed')
  })

  it('redacts the same secret twice', () => {
    const once = redactText('pos_one and pos_two')
    const twice = redactText('pos_one and pos_two')
    expect(once).not.toContain('pos_one')
    expect(twice).not.toContain('pos_two')
  })
})
