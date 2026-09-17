import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  LANGUAGE_NATIVE_NAMES,
  SUPPORTED_LANGUAGES,
  changeAppLanguage,
  isSupportedLanguage,
  type SupportedLanguage,
} from '../i18n'

type LanguageSelectorProps = {
  id?: string
  className?: string
  /** Prefer opening the menu above the trigger when space allows. */
  menuPlacement?: 'up' | 'down'
}

function resolveCurrentLanguage(language: string): SupportedLanguage {
  const activeLanguage = isSupportedLanguage(language)
    ? language
    : (language.split('-')[0] as string)
  return isSupportedLanguage(activeLanguage) ? activeLanguage : 'en'
}

type MenuCoords = {
  top: number
  left: number
  width: number
  placement: 'up' | 'down'
}

export function LanguageSelector({
  id,
  className = 'rounded-full border border-border-hairline bg-canvas-raised px-3 py-2 text-sm text-ink transition hover:bg-accent-primary-soft',
  menuPlacement = 'down',
}: LanguageSelectorProps) {
  const { t, i18n } = useTranslation()
  const generatedId = useId()
  const triggerId = id ?? `language-select-${generatedId}`
  const listboxId = `${triggerId}-listbox`
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<MenuCoords | null>(null)
  const currentLanguage = resolveCurrentLanguage(i18n.language)

  function updateMenuPosition() {
    const trigger = triggerRef.current
    if (!trigger) return

    const rect = trigger.getBoundingClientRect()
    const menuHeight = menuRef.current?.offsetHeight ?? 220
    const gap = 6
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top

    let placement = menuPlacement
    if (placement === 'down' && spaceBelow < menuHeight + gap && spaceAbove > spaceBelow) {
      placement = 'up'
    } else if (placement === 'up' && spaceAbove < menuHeight + gap && spaceBelow > spaceAbove) {
      placement = 'down'
    }

    const top =
      placement === 'up' ? rect.top - gap - menuHeight : rect.bottom + gap

    setCoords({
      top: Math.max(8, top),
      left: rect.left,
      width: rect.width,
      placement,
    })
  }

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null)
      return
    }
    updateMenuPosition()
    // Remeasure after paint once the menu has real height.
    const frame = window.requestAnimationFrame(() => updateMenuPosition())
    return () => window.cancelAnimationFrame(frame)
  }, [open, menuPlacement])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (
        containerRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    function handleReposition() {
      updateMenuPosition()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleReposition)
    window.addEventListener('scroll', handleReposition, true)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleReposition)
      window.removeEventListener('scroll', handleReposition, true)
    }
  }, [open, menuPlacement])

  function openMenu() {
    const trigger = triggerRef.current
    if (trigger) {
      const rect = trigger.getBoundingClientRect()
      setCoords({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width,
        placement: 'down',
      })
    }
    setOpen(true)
  }

  async function selectLanguage(code: SupportedLanguage) {
    setOpen(false)
    if (code === currentLanguage) return
    await changeAppLanguage(code)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <label className="sr-only" htmlFor={triggerId}>
        {t('topBar.language')}
      </label>
      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          openMenu()
        }}
        className={`inline-flex w-full items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/30 ${className}`}
      >
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-primary-soft text-accent-primary">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            className="h-3.5 w-3.5"
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <path
              d="M3 12h18M12 3c2.5 2.8 2.5 15.2 0 18M12 3c-2.5 2.8-2.5 15.2 0 18"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">
          {LANGUAGE_NATIVE_NAMES[currentLanguage]}
        </span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          className={`h-3.5 w-3.5 shrink-0 text-ink-muted transition ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && coords ? (
        <ul
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={triggerId}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: coords.width,
          }}
          className="z-[80] max-h-60 overflow-y-auto rounded-2xl border border-border-hairline bg-canvas-raised p-1.5 shadow-[0_18px_40px_rgba(28,27,41,0.14)]"
        >
          {SUPPORTED_LANGUAGES.map((code) => {
            const selected = code === currentLanguage
            return (
              <li key={code} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onClick={() => void selectLanguage(code)}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                    selected
                      ? 'bg-accent-primary-soft font-semibold text-accent-primary-deep'
                      : 'text-ink hover:bg-canvas'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {LANGUAGE_NATIVE_NAMES[code]}
                  </span>
                  {selected ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="h-4 w-4 shrink-0 text-accent-primary"
                      aria-hidden
                    >
                      <path
                        d="M5 13l4 4L19 7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
