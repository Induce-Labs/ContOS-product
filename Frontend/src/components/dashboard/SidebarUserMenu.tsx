import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSelector } from '../LanguageSelector'
import { MoonIcon, SignOutIcon } from '../icons/ActionIcons'
import { useTheme } from '../../hooks/useTheme'

type SidebarUserMenuProps = {
  userEmail?: string | null
  isSigningOut: boolean
  onSignOut: () => void
  collapsed?: boolean
}

function emailLocalPart(email: string | null | undefined) {
  const trimmed = email?.trim() ?? ''
  if (!trimmed) return ''
  return trimmed.split('@')[0] ?? trimmed
}

function displayNameFromEmail(email: string | null | undefined) {
  const local = emailLocalPart(email)
  if (!local) return 'User'
  const firstSegment = local.split(/[._-]/u)[0] || local
  return firstSegment.charAt(0).toUpperCase() + firstSegment.slice(1)
}

function handleFromEmail(email: string | null | undefined) {
  const local = emailLocalPart(email)
  if (!local) return '@user'
  return `@${local}`
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
  const handle = handleFromEmail(userEmail)
  const initial = initialsFromEmail(userEmail)
  const isDark = theme === 'dark'

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

  function toggleDarkMode() {
    setTheme(isDark ? 'light' : 'dark')
  }

  const sectionLabelClass =
    'mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted'

  return (
    <div ref={containerRef} className={collapsed ? 'relative' : 'relative px-3 pb-4 pt-2'}>
      {open ? (
        <div
          role="menu"
          className={
            collapsed
              ? 'absolute bottom-0 left-full z-[60] ml-2 w-64 rounded-2xl border border-[#f0ecf6] bg-white p-3 shadow-[0_12px_28px_rgba(90,70,130,0.10)] dark:border-border-hairline dark:bg-canvas-raised'
              : 'absolute bottom-full left-3 right-3 z-[60] mb-2 rounded-2xl border border-[#f0ecf6] bg-white p-3 shadow-[0_12px_28px_rgba(90,70,130,0.10)] dark:border-border-hairline dark:bg-canvas-raised'
          }
        >
          <section>
            <p className={sectionLabelClass}>{t('layout.userMenu.account')}</p>
            <div className="flex items-center gap-2 rounded-xl bg-[#f4effc] px-2 py-1.5 dark:bg-accent-primary-soft/40">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#e4d8fb] text-xs font-semibold text-[#5c4580] dark:bg-accent-primary dark:text-btn-primary-fg">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{displayName}</p>
                <p className="truncate text-xs text-ink-muted">{handle}</p>
              </div>
              <span className="inline-flex shrink-0 items-center rounded-full bg-[#ebe4fe] px-2 py-0.5 text-[10px] font-semibold text-[#6b4f92] dark:bg-accent-primary dark:text-btn-primary-fg">
                {t('layout.userMenu.productBadge')}
              </span>
            </div>
          </section>

          <div className="my-2 border-t border-[#efeaf4] dark:border-border-hairline" />

          <section>
            <p className={sectionLabelClass}>{t('layout.userMenu.appearance')}</p>
            <div className="flex items-center gap-2 px-0.5 py-0.5">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f3eefe] text-[#6b4f92] dark:bg-accent-primary-soft dark:text-accent-primary-deep">
                <MoonIcon className="h-3.5 w-3.5 shrink-0" />
              </span>
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                {t('layout.userMenu.darkMode')}
              </p>
              <button
                type="button"
                role="switch"
                aria-checked={isDark}
                aria-label={t('layout.userMenu.darkMode')}
                onClick={toggleDarkMode}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary-hover ${
                  isDark ? 'bg-accent-primary' : 'bg-[#d9d5e0]'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                    isDark ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </section>

          <div className="my-2 border-t border-[#efeaf4] dark:border-border-hairline" />

          <section>
            <p className={sectionLabelClass}>{t('layout.userMenu.language')}</p>
            <LanguageSelector
              id="sidebar-user-language-select"
              menuPlacement="up"
              variant="settings"
              className="w-full rounded-xl border border-[#ece8f4] bg-white px-2 py-1.5 text-sm text-ink transition hover:border-accent-primary/30 hover:bg-accent-primary-soft/40 dark:border-border-hairline dark:bg-canvas-raised"
            />
          </section>

          <div className="my-2 border-t border-[#efeaf4] dark:border-border-hairline" />

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onSignOut()
            }}
            disabled={isSigningOut}
            className="flex w-full items-center gap-2 rounded-xl bg-[#fdecee] px-2 py-1.5 text-left transition hover:bg-[#fbdfe3] disabled:opacity-60 dark:bg-red-950/40 dark:hover:bg-red-950/60"
          >
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f8d5da] text-red-600 dark:bg-red-950/70 dark:text-red-400">
              <SignOutIcon className="h-3.5 w-3.5 shrink-0" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold leading-tight text-red-600 dark:text-red-400">
                {isSigningOut ? t('topBar.signingOut') : t('layout.userMenu.signOut')}
              </span>
              <span className="block truncate text-[11px] leading-tight text-ink-muted">
                {t('layout.userMenu.signOutHint')}
              </span>
            </span>
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('layout.userMenu.openAria')}
        className={`flex items-center transition ${
          collapsed
            ? 'h-10 w-10 justify-center rounded-full p-0'
            : 'w-full gap-2.5 rounded-2xl border border-white/70 bg-white/40 px-2.5 py-2 text-left backdrop-blur-sm hover:bg-white/55 dark:border-white/10 dark:bg-white/10 dark:hover:bg-white/15'
        }`}
      >
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e4d8fb] text-xs font-semibold text-[#5c4580] dark:bg-accent-primary dark:text-btn-primary-fg">
          {initial}
        </span>
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{displayName}</span>
              {userEmail ? (
                <span className="mt-0.5 block truncate text-xs text-ink-muted">{userEmail}</span>
              ) : null}
            </span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className="h-4 w-4 shrink-0 text-ink-muted"
              aria-hidden
            >
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        ) : null}
      </button>
    </div>
  )
}
