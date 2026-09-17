import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  applyEffectiveTheme,
  persistTheme,
  readStoredTheme,
  type ThemeMode,
} from '../lib/theme'
import { ThemeContext, type ThemeContextValue } from './theme-context'

type ThemeProviderProps = {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { pathname } = useLocation()
  const { user, isLoading: authLoading } = useAuth()
  const userId = user?.id ?? null

  const [theme, setThemeState] = useState<ThemeMode>('light')

  // Load this user's preference (or light for signed-out / new users).
  useEffect(() => {
    if (authLoading) {
      return
    }
    const next = readStoredTheme(userId)
    setThemeState(next)
    applyEffectiveTheme(pathname, next)
  }, [authLoading, userId, pathname])

  useEffect(() => {
    applyEffectiveTheme(pathname, theme)
  }, [pathname, theme])

  const setTheme = useCallback(
    (next: ThemeMode) => {
      persistTheme(next, { pathname, userId })
      setThemeState(next)
    },
    [pathname, userId],
  )

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [setTheme, theme])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
