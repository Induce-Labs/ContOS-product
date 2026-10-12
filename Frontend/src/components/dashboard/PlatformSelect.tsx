import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { CompetitorPlatform } from '../../types/contos'

const PLATFORMS: CompetitorPlatform[] = ['instagram', 'linkedin', 'twitter']

type PlatformSelectProps = {
  value: CompetitorPlatform
  disabled?: boolean
  onChange: (platform: CompetitorPlatform) => void
}

function InstagramIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-4 w-4 shrink-0 text-pink-500">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function LinkedInIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0 text-blue-500">
      <path d="M6.5 9.5H3.7V20h2.8V9.5ZM5.1 4a1.65 1.65 0 1 0 0 3.3 1.65 1.65 0 0 0 0-3.3ZM20.3 20h-2.8v-5.6c0-1.6-.6-2.7-2.1-2.7-1.1 0-1.7.7-2 1.4-.1.3-.1.6-.1.9V20h-2.8s.04-9.2 0-10.5h2.8v1.5c.4-.6 1.1-1.7 2.8-1.7 2 0 3.5 1.3 3.5 4.2V20Z" />
    </svg>
  )
}

function TwitterIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 shrink-0 text-ink">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.74l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
    </svg>
  )
}

function PlatformIcon({ platform }: { platform: CompetitorPlatform }) {
  if (platform === 'linkedin') return <LinkedInIcon />
  if (platform === 'twitter') return <TwitterIcon />
  return <InstagramIcon />
}

export function PlatformSelect({ value, disabled = false, onChange }: PlatformSelectProps) {
  const { t } = useTranslation()
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(() => Math.max(0, PLATFORMS.indexOf(value)))
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (disabled) {
      setOpen(false)
    }
  }, [disabled])

  function placeMenu() {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return

    const rect = trigger.getBoundingClientRect()
    const gap = 6
    const menuHeight = menu.offsetHeight
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < menuHeight + gap && rect.top > spaceBelow
    const top = openUp ? rect.top - gap - menuHeight : rect.bottom + gap
    const width = Math.max(rect.width, 220)
    const left = Math.min(rect.left, window.innerWidth - width - 8)

    setCoords({
      top: Math.max(8, top),
      left: Math.max(8, left),
      width,
    })
  }

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }

    placeMenu()
    const frame = window.requestAnimationFrame(() => placeMenu())
    window.addEventListener('resize', placeMenu)
    window.addEventListener('scroll', placeMenu, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', placeMenu)
      window.removeEventListener('scroll', placeMenu, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setOpen(false)
        triggerRef.current?.focus()
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        setHighlight((current) => (current + direction + PLATFORMS.length) % PLATFORMS.length)
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopImmediatePropagation()
        const next = PLATFORMS[highlight]
        if (next) {
          onChange(next)
        }
        setOpen(false)
        triggerRef.current?.focus()
      }
    }

    function handleFocusIn(event: FocusEvent) {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('focusin', handleFocusIn)
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('focusin', handleFocusIn)
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open, highlight, onChange])

  function openMenu() {
    if (disabled) return
    setHighlight(Math.max(0, PLATFORMS.indexOf(value)))
    setOpen(true)
  }

  function choose(platform: CompetitorPlatform) {
    onChange(platform)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={t('dashboard.columns.platform')}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(event) => {
          if (disabled) return
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            openMenu()
          }
        }}
        className="inline-flex min-w-[11.5rem] cursor-pointer items-center justify-between gap-3 rounded-xl border border-border-hairline bg-canvas px-3.5 py-2.5 text-sm font-medium text-ink transition hover:border-ink-muted/40 focus:border-accent-primary focus:outline-none focus:ring-4 focus:ring-accent-primary-soft/50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex min-w-0 items-center gap-2">
          <PlatformIcon platform={value} />
          <span>{t(`common.platforms.${value}`)}</span>
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 text-ink-muted transition ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              id={listId}
              role="listbox"
              aria-label={t('dashboard.columns.platform')}
              style={{
                top: coords?.top ?? -9999,
                left: coords?.left ?? 0,
                width: coords?.width ?? 220,
              }}
              className="fixed z-[60] overflow-hidden rounded-xl border border-border-hairline bg-canvas-raised py-1 shadow-[0_16px_40px_rgba(0,0,0,0.28)]"
            >
              {PLATFORMS.map((platform, index) => {
                const selected = platform === value
                const active = index === highlight
                return (
                  <button
                    key={platform}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(platform)}
                    className={`flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-ink ${
                      active ? 'bg-accent-primary-soft' : 'hover:bg-canvas'
                    }`}
                  >
                    <PlatformIcon platform={platform} />
                    <span className="flex-1">{t(`common.platforms.${platform}`)}</span>
                    {selected ? (
                      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-accent-primary-deep">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : null}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
