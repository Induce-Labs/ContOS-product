import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentType } from '../../lib/agentsApi'
import type { ChatStore } from '../../lib/agentChatStorage'
import { listChatSessions, sessionHasUserMessages } from '../../lib/agentChatStorage'

type AgentChatHistoryPanelProps = {
  chatStore: ChatStore | null
  onSelectSession: (sessionId: string) => void
  onClose: () => void
}

function formatSessionTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function AgentChatHistoryPanel({
  chatStore,
  onSelectSession,
  onClose,
}: AgentChatHistoryPanelProps) {
  const { t } = useTranslation()

  return (
    <div className="mb-4 rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_12px_30px_rgba(28,27,41,0.05)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">{t('agents.history.title')}</p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-muted hover:text-ink"
        >
          {t('agents.history.close')}
        </button>
      </div>
      {chatStore && listChatSessions(chatStore).length > 0 ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {listChatSessions(chatStore).map((session) => {
            const isActive = session.id === chatStore.activeSessionId
            return (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                  className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                    isActive
                      ? 'bg-accent-primary text-btn-primary-fg'
                      : 'hover:bg-accent-primary-soft'
                  }`}
                >
                  <span className="block truncate text-sm font-medium">{session.title}</span>
                  <span
                    className={`mt-0.5 block text-xs ${
                      isActive ? 'text-btn-primary-fg/70' : 'text-ink-muted'
                    }`}
                  >
                    {formatSessionTime(session.updatedAt)}
                    {isActive ? t('agents.history.currentSuffix') : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">{t('agents.history.empty')}</p>
      )}
    </div>
  )
}

type AgentTypePillsProps = {
  agentType: AgentType
  /** Kept for callers; pills stay clickable so mid-stream tab switches do not block UX. */
  streaming?: boolean
  options: Array<{ value: AgentType; label: string }>
  onChange: (value: AgentType) => void
}

export function AgentTypePills({
  agentType,
  streaming: _streaming = false,
  options,
  onChange,
}: AgentTypePillsProps) {
  void _streaming
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; minWidth: number } | null>(
    null,
  )
  const selected = options.find((option) => option.value === agentType) ?? options[0]

  function placeMenu() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setMenuBox({ top: rect.bottom + 8, left: rect.left, minWidth: rect.width })
  }

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node
      if (
        containerRef.current?.contains(target) ||
        document.getElementById('agent-type-menu')?.contains(target)
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
      placeMenu()
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
  }, [open])

  if (!selected) return null

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          placeMenu()
          setOpen(true)
        }}
        className="contos-btn contos-btn--pill contos-btn--secondary inline-flex items-center gap-2"
      >
        <span>{selected.label}</span>
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
      {open && menuBox ? (
        <ul
          id="agent-type-menu"
          role="listbox"
          aria-label={selected.label}
          style={{
            position: 'fixed',
            top: menuBox.top,
            left: menuBox.left,
            minWidth: menuBox.minWidth,
          }}
          className="z-[80] rounded-2xl border border-[#ece8f4] bg-white p-1.5 shadow-[0_12px_28px_rgba(90,70,130,0.10)] dark:border-border-hairline dark:bg-canvas-raised"
        >
          {options.map((option) => {
            const isActive = agentType === option.value
            return (
              <li key={option.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    onChange(option.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center whitespace-nowrap rounded-xl px-3 py-2 text-left text-sm font-medium transition ${
                    isActive
                      ? 'bg-[#e8e0fe] text-ink dark:bg-accent-primary dark:text-btn-primary-fg'
                      : 'text-ink-muted hover:bg-accent-primary-soft/60 hover:text-ink'
                  }`}
                >
                  {option.label}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

export function previousChatCount(chatStore: ChatStore | null): number {
  if (!chatStore) {
    return 0
  }

  return listChatSessions(chatStore).filter((session) =>
    sessionHasUserMessages(session.messages),
  ).length
}
