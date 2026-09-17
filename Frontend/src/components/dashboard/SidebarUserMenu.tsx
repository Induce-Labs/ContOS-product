import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSelector } from '../LanguageSelector'
import { useTheme } from '../../hooks/useTheme'
import type { ThemeMode } from '../../lib/theme'

type SidebarUserMenuProps = {
  userEmail?: string | null
  isSigningOut: boolean
  onSignOut: () => void
  collapsed?: boolean
}

function displayNameFromEmail(email: string | null | undefined) {
  const trimmed = email?.trim() ?? ''
  if (!trimmed) return 'User'
  const local = trimmed.split('@')[0] ?? trimmed
  return local || trimmed
}

function initialsFromEmail(email: string | null | undefined) {
  const name = displayNameFromEmail(email)
  return name.slice(0, 1).toUpperCase()
}

export function SidebarUserMenu({
  userEmail,
  isSigningOut,
  onSignOut,
  collapsed = false,
}: SidebarUserMenuProps) {
  const { t } = useTranslation()
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const displayName = displayNameFromEmail(userEmail)
  const initial = initialsFromEmail(userEmail)

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  function themeButtonClass(mode: ThemeMode) {
    return theme === mode
      ? 'flex-1 rounded-lg bg-accent-primary px-2.5 py-1.5 text-sm font-medium text-white'
      : 'flex-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-muted transition hover:bg-canvas hover:text-ink'
  }

  return (
    <div ref={containerRef} className={collapsed ? 'relative' : 'relative px-3 pb-4 pt-2'}>
      {open ? (
        <div
          role="menu"
          className={
            collapsed
              ? 'absolute bottom-0 left-full z-[60] ml-3 w-64 rounded-2xl border border-border-hairline bg-canvas-raised p-2 shadow-[0_18px_40px_rgba(28,27,41,0.14)]'
              : 'absolute bottom-full left-3 right-3 z-[60] mb-3 rounded-2xl border border-border-hairline bg-canvas-raised p-2 shadow-[0_18px_40px_rgba(28,27,41,0.14)]'
          }
        >
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-primary text-sm font-semibold text-white">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{displayName}</p>
              {userEmail ? (
                <p className="truncate text-xs text-ink-muted">{userEmail}</p>
              ) : null}
            </div>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-4 w-4 shrink-0 text-accent-primary"
              aria-hidden
            >
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <div className="my-1 border-t border-border-hairline" />

          <div className="px-2 py-2">
            <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {t('layout.userMenu.appearance')}
            </p>
            <div
              role="group"
              aria-label={t('layout.userMenu.appearance')}
              className="flex gap-1 rounded-xl border border-border-hairline bg-canvas p-1"
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={theme === 'light'}
                onClick={() => setTheme('light')}
                className={themeButtonClass('light')}
              >
                {t('layout.userMenu.light')}
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={theme === 'dark'}
                onClick={() => setTheme('dark')}
                className={themeButtonClass('dark')}
              >
                {t('layout.userMenu.dark')}
              </button>
            </div>
          </div>

          <div className="my-1 border-t border-border-hairline" />

          <div className="px-2 py-2">
            <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
              {t('layout.userMenu.language')}
            </p>
            <LanguageSelector
              id="sidebar-user-language-select"
              menuPlacement="up"
              className="w-full rounded-xl border border-border-hairline bg-canvas px-2.5 py-1.5 text-sm text-ink transition hover:border-accent-primary/30 hover:bg-accent-primary-soft/50"
            />
          </div>

          <div className="my-1 border-t border-border-hairline" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onSignOut()
            }}
            disabled={isSigningOut}
            className="flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            {isSigningOut ? t('topBar.signingOut') : t('layout.userMenu.signOut')}
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('layout.userMenu.openAria')}
        className={`flex items-center rounded-xl border border-transparent transition hover:bg-canvas ${
          collapsed ? 'h-10 w-10 justify-center p-0' : 'w-full gap-3 px-2 py-2'
        }`}
      >
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-primary text-sm font-semibold text-white">
          {initial}
        </span>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink">
              {displayName}
            </span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className={`h-4 w-4 shrink-0 text-ink-muted transition ${open ? 'rotate-180' : ''}`}
              aria-hidden
            >
              <path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        ) : null}
      </button>
    </div>
  )
}
