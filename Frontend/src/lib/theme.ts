export const THEME_STORAGE_KEY = 'contos_theme'
export const THEME_USER_PREFIX = 'contos_theme_user:'

export type ThemeMode = 'light' | 'dark'

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark'
}

function userThemeKey(userId: string): string {
  return `${THEME_USER_PREFIX}${userId}`
}

/** Last-applied theme for FOUC on dashboard routes (not user-authoritative). */
export function readLastAppliedTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemeMode(stored)) {
      return stored
    }
  } catch {
    // localStorage may be unavailable
  }
  return 'light'
}

/**
 * Theme for a signed-in user. Missing key → light (new users always start light).
 * Signed-out callers should pass null and get light.
 */
export function readStoredTheme(userId: string | null | undefined): ThemeMode {
  if (!userId) {
    return 'light'
  }

  try {
    const stored = localStorage.getItem(userThemeKey(userId))
    if (isThemeMode(stored)) {
      return stored
    }
  } catch {
    // localStorage may be unavailable
  }
  return 'light'
}

export function applyThemeClass(theme: ThemeMode): void {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

function isNewProjectPath(pathname: string): boolean {
  return (
    pathname === '/projects/new' ||
    pathname.startsWith('/projects/new/') ||
    pathname === '/avatars/new' ||
    pathname.startsWith('/avatars/new/')
  )
}

/** Dark preference on the dashboard and the signed-in new-project wizard. First-time /onboarding stays light. */
export function pathAllowsDarkTheme(pathname: string): boolean {
  return pathname.startsWith('/dashboard') || isNewProjectPath(pathname)
}

export function applyEffectiveTheme(pathname: string, stored: ThemeMode): void {
  applyThemeClass(pathAllowsDarkTheme(pathname) ? stored : 'light')
}

export function persistTheme(
  theme: ThemeMode,
  options?: { pathname?: string; userId?: string | null },
): void {
  const pathname = options?.pathname
  const userId = options?.userId

  try {
    // FOUC hint for next dashboard paint
    localStorage.setItem(THEME_STORAGE_KEY, theme)
    if (userId) {
      localStorage.setItem(userThemeKey(userId), theme)
    }
  } catch {
    // Prefer applying the class even if persistence fails.
  }

  if (pathname !== undefined) {
    applyEffectiveTheme(pathname, theme)
  } else {
    applyThemeClass(theme)
  }
}
