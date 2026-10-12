import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getSession, exchangeCodeForSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSession(...args),
      exchangeCodeForSession: (...args: unknown[]) => exchangeCodeForSession(...args),
    },
  },
}))

import { completeOAuthCallback } from './auth'

describe('completeOAuthCallback', () => {
  beforeEach(() => {
    getSession.mockReset()
    exchangeCodeForSession.mockReset()
  })

  it('removes the OAuth code from the URL after a session exists', async () => {
    const url = new URL(
      'http://localhost:5173/auth/callback?code=one-time-code&next=%2Fdashboard#error',
    )
    const replaceState = vi.fn((_state: unknown, _title: string, next: string) => {
      const updated = new URL(next, url.origin)
      url.pathname = updated.pathname
      url.search = updated.search
      url.hash = updated.hash
    })
    vi.stubGlobal('window', {
      location: url,
      history: { state: { from: 'test' }, replaceState },
      setTimeout: globalThis.setTimeout.bind(globalThis),
    })
    getSession.mockResolvedValue({
      data: { session: { access_token: 'session-token' } },
      error: null,
    })

    await completeOAuthCallback()

    expect(exchangeCodeForSession).not.toHaveBeenCalled()
    expect(replaceState).toHaveBeenCalledOnce()
    const nextUrl = String(replaceState.mock.calls[0]?.[2])
    expect(nextUrl).not.toContain('code=')
    expect(nextUrl).not.toContain('one-time-code')
    expect(nextUrl).not.toContain('error_description')
    expect(nextUrl).toContain('next=%2Fdashboard')
    expect(nextUrl).toContain('#error')
    expect(replaceState.mock.calls[0]?.[0]).toEqual({ from: 'test' })
  })
})
