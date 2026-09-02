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
  return (
    <div className="mb-4 rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_12px_30px_rgba(28,27,41,0.05)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">Previous chats</p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-ink-muted hover:text-ink"
        >
          Close
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
                    isActive ? 'bg-accent-primary text-white' : 'hover:bg-accent-primary-soft'
                  }`}
                >
                  <span className="block truncate text-sm font-medium">{session.title}</span>
                  <span
                    className={`mt-0.5 block text-xs ${
                      isActive ? 'text-white/80' : 'text-ink-muted'
                    }`}
                  >
                    {formatSessionTime(session.updatedAt)}
                    {isActive ? ' · Current' : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">
          No earlier chats yet. Start a conversation, then use New chat to begin another thread.
        </p>
      )}
    </div>
  )
}

type AgentTypePillsProps = {
  agentType: AgentType
  streaming: boolean
  options: Array<{ value: AgentType; label: string }>
  onChange: (value: AgentType) => void
}

export function AgentTypePills({
  agentType,
  streaming,
  options,
  onChange,
}: AgentTypePillsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={streaming}
          onClick={() => onChange(option.value)}
          className={`rounded-full px-3 py-1.5 text-sm transition ${
            agentType === option.value
              ? 'bg-accent-primary text-white'
              : 'border border-border-hairline bg-white text-ink-muted hover:bg-accent-primary-soft'
          }`}
        >
          {option.label}
        </button>
      ))}
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
