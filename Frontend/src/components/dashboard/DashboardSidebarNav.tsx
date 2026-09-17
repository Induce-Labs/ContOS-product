import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../hooks/useAuth'
import type { AgentType } from '../../lib/agentsApi'
import {
  peekLocalChatSessions,
  type ChatSession,
} from '../../lib/agentChatStorage'

type DashboardSidebarNavProps = {
  projectId: string | null
  onNavigate?: () => void
  collapsed?: boolean
}

function NavIcon({ name, className }: { name: string; className?: string }) {
  const cn = className ?? 'h-4 w-4 shrink-0'
  switch (name) {
    case 'chat':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={cn} aria-hidden>
          <path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 1 1 18 0Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'history':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={cn} aria-hidden>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l2.5 2.5" strokeLinecap="round" />
        </svg>
      )
    case 'calendar':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={cn} aria-hidden>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M8 3.5v3M16 3.5v3M3.5 10h17" strokeLinecap="round" />
        </svg>
      )
    case 'insights':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={cn} aria-hidden>
          <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" strokeLinecap="round" />
        </svg>
      )
    case 'profiling':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={cn} aria-hidden>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20c1.2-3 3.4-4.5 7-4.5s5.8 1.5 7 4.5" strokeLinecap="round" />
        </svg>
      )
    case 'overview':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={cn} aria-hidden>
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
          <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
          <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
        </svg>
      )
    case 'linkedin':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={cn} aria-hidden>
          <path d="M6.5 9.5H3.7V20h2.8V9.5ZM5.1 4a1.65 1.65 0 1 0 0 3.3 1.65 1.65 0 0 0 0-3.3ZM20.3 20h-2.8v-5.6c0-1.6-.6-2.7-2.1-2.7-1.1 0-1.7.7-2 1.4-.1.3-.1.6-.1.9V20h-2.8s.04-9.2 0-10.5h2.8v1.5c.4-.6 1.1-1.7 2.8-1.7 2 0 3.5 1.3 3.5 4.2V20Z" />
        </svg>
      )
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className={cn} aria-hidden>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'x':
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={cn} aria-hidden>
          <path d="M4 4h3.6l4.3 5.8L16.8 4H20l-6.2 7.2L20.2 20h-3.6l-4.6-6.2L7.2 20H4l6.5-7.6L4 4Z" />
        </svg>
      )
    default:
      return null
  }
}

type NavItem = {
  id: string
  label: string
  href: string
  icon: string
  isActive: (pathname: string) => boolean
  agentType?: AgentType
}

function persistAgentType(agentType: AgentType) {
  try {
    if (agentType === 'linkedin' || agentType === 'instagram' || agentType === 'chatbot') {
      sessionStorage.setItem('contos_agents_agent_type', agentType)
    }
  } catch {
    // ignore
  }
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

function ChatHistoryDropdown({
  projectId,
  collapsed,
  onNavigate,
}: {
  projectId: string
  collapsed: boolean
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [sessions, setSessions] = useState<ChatSession[]>([])

  useEffect(() => {
    if (!open) return

    function refreshSessions() {
      if (!user?.id) {
        setSessions([])
        return
      }
      setSessions(peekLocalChatSessions(user.id, projectId))
    }

    refreshSessions()

    function onStoreUpdated(event: Event) {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail
      if (detail?.projectId && detail.projectId !== projectId) return
      refreshSessions()
    }

    window.addEventListener('contos-chat-store-updated', onStoreUpdated)
    return () => window.removeEventListener('contos-chat-store-updated', onStoreUpdated)
  }, [open, projectId, user?.id])

  useEffect(() => {
    if (!open) return

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
  }, [open])

  function selectSession(sessionId: string) {
    setOpen(false)
    navigate(
      `/dashboard/${projectId}/agents?session=${encodeURIComponent(sessionId)}`,
    )
    onNavigate?.()
  }

  const triggerClass = collapsed
    ? `flex h-10 w-10 items-center justify-center rounded-xl transition ${
        open
          ? 'bg-accent-primary text-white'
          : 'text-ink-muted hover:bg-canvas hover:text-ink'
      }`
    : `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
        open
          ? 'bg-accent-primary text-white'
          : 'text-ink-muted hover:bg-accent-primary-soft/60 hover:text-ink'
      }`

  const list = (
    <div
      className={
        collapsed
          ? 'absolute left-full top-0 z-50 ml-2 w-64 rounded-2xl border border-border-hairline bg-canvas-raised p-2 shadow-[0_18px_40px_rgba(28,27,41,0.12)]'
          : 'mt-1 space-y-0.5 rounded-xl bg-canvas p-1.5'
      }
    >
      {sessions.length > 0 ? (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto">
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => selectSession(session.id)}
                className="w-full rounded-lg px-2.5 py-2 text-left transition hover:bg-canvas-raised hover:shadow-sm"
              >
                <span className="block truncate text-sm font-medium text-ink">
                  {session.title}
                </span>
                <span className="mt-0.5 block text-[11px] text-ink-muted">
                  {formatSessionTime(session.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-2.5 py-2 text-xs text-ink-muted">{t('agents.history.empty')}</p>
      )}
    </div>
  )

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={t('nav.chatHistory')}
        aria-label={t('nav.chatHistory')}
        className={triggerClass}
      >
        <NavIcon
          name="history"
          className={collapsed ? 'h-[18px] w-[18px] shrink-0' : 'h-4 w-4 shrink-0 opacity-80'}
        />
        {!collapsed ? (
          <>
            <span className="min-w-0 flex-1 truncate text-left">{t('nav.chatHistory')}</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className={`h-3.5 w-3.5 shrink-0 transition ${
                open ? 'rotate-180 text-white' : 'text-ink-muted'
              }`}
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </>
        ) : null}
      </button>
      {open ? list : null}
    </div>
  )
}

export function DashboardSidebarNav({
  projectId,
  onNavigate,
  collapsed = false,
}: DashboardSidebarNavProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()

  if (!projectId) {
    return (
      <nav className={`flex-1 py-5 ${collapsed ? 'px-2' : 'px-4'}`}>
        {!collapsed ? (
          <p className="text-sm text-ink-muted">{t('nav.createProjectToUnlock')}</p>
        ) : null}
      </nav>
    )
  }

  const agentsBase = `/dashboard/${projectId}/agents`

  const primaryBeforeHistory: NavItem[] = [
    {
      id: 'chatbot',
      label: t('nav.chatbot'),
      href: agentsBase,
      icon: 'chat',
      agentType: 'chatbot',
      isActive: (pathname) => pathname === agentsBase,
    },
  ]

  const primaryAfterHistory: NavItem[] = [
    {
      id: 'calendar',
      label: t('nav.calendar'),
      href: `/dashboard/${projectId}/calendar`,
      icon: 'calendar',
      isActive: (pathname) => pathname === `/dashboard/${projectId}/calendar`,
    },
    {
      id: 'insights',
      label: t('nav.insights'),
      href: `/dashboard/${projectId}/insights`,
      icon: 'insights',
      isActive: (pathname) => pathname === `/dashboard/${projectId}/insights`,
    },
  ]

  const projectItems: NavItem[] = [
    {
      id: 'profiling',
      label: t('nav.profiling'),
      href: `/dashboard/${projectId}/profiling`,
      icon: 'profiling',
      isActive: (pathname) => pathname === `/dashboard/${projectId}/profiling`,
    },
    {
      id: 'overview',
      label: t('nav.overview'),
      href: `/dashboard/${projectId}`,
      icon: 'overview',
      isActive: (pathname) => pathname === `/dashboard/${projectId}`,
    },
  ]

  const contentAgentItems: NavItem[] = [
    {
      id: 'linkedin',
      label: t('agents.agentTypes.linkedin'),
      href: agentsBase,
      icon: 'linkedin',
      agentType: 'linkedin',
      isActive: () => false,
    },
    {
      id: 'instagram',
      label: t('agents.agentTypes.instagram'),
      href: agentsBase,
      icon: 'instagram',
      agentType: 'instagram',
      isActive: () => false,
    },
    {
      id: 'x',
      label: t('nav.x'),
      href: agentsBase,
      icon: 'x',
      isActive: () => false,
    },
  ]

  function handleNavClick(item: NavItem) {
    if (item.agentType) {
      persistAgentType(item.agentType)
    }
    onNavigate?.()
    if (item.agentType && location.pathname === agentsBase) {
      navigate(item.href, { replace: true })
      window.dispatchEvent(
        new CustomEvent('contos-agent-type', { detail: { agentType: item.agentType } }),
      )
    }
  }

  function renderLink(item: NavItem) {
    const isActive = item.isActive(location.pathname)

    if (collapsed) {
      return (
        <Link
          key={item.id}
          to={item.href}
          onClick={() => handleNavClick(item)}
          title={item.label}
          aria-label={item.label}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition ${
            isActive
              ? 'bg-accent-primary text-white'
              : 'text-ink-muted hover:bg-canvas hover:text-ink'
          }`}
        >
          <NavIcon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
        </Link>
      )
    }

    return (
      <Link
        key={item.id}
        to={item.href}
        onClick={() => handleNavClick(item)}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
          isActive
            ? 'bg-accent-primary text-white'
            : 'text-ink-muted hover:bg-accent-primary-soft/60 hover:text-ink'
        }`}
      >
        <NavIcon name={item.icon} className="h-4 w-4 shrink-0 opacity-80" />
        <span>{item.label}</span>
      </Link>
    )
  }

  return (
    <nav
      className={`flex min-h-0 flex-1 flex-col font-sans ${
        collapsed ? 'items-center px-0 py-1' : 'px-3 py-3'
      }`}
    >
      <div
        className={`min-h-0 w-full flex-1 overflow-y-auto pb-2 ${
          collapsed
            ? 'flex flex-col items-center gap-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            : 'space-y-5'
        }`}
      >
        <div
          className={
            collapsed
              ? 'mt-3 flex w-full flex-col items-center gap-1'
              : 'space-y-0.5'
          }
        >
          {primaryBeforeHistory.map(renderLink)}
          <ChatHistoryDropdown
            projectId={projectId}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
          {primaryAfterHistory.map(renderLink)}
        </div>

        <div className={collapsed ? 'flex w-full flex-col items-center' : ''}>
          {!collapsed ? (
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              {t('nav.projects')}
            </p>
          ) : (
            <div className="my-2 h-px w-8 bg-border-hairline" aria-hidden />
          )}
          <div
            className={
              collapsed ? 'flex w-full flex-col items-center gap-1' : 'space-y-0.5'
            }
          >
            {projectItems.map(renderLink)}
          </div>
        </div>

        <div className={collapsed ? 'flex w-full flex-col items-center' : ''}>
          {!collapsed ? (
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              {t('nav.contentAgent')}
            </p>
          ) : (
            <div className="my-2 h-px w-8 bg-border-hairline" aria-hidden />
          )}
          <div
            className={
              collapsed ? 'flex w-full flex-col items-center gap-1' : 'space-y-0.5'
            }
          >
            {contentAgentItems.map(renderLink)}
          </div>
        </div>
      </div>
    </nav>
  )
}
