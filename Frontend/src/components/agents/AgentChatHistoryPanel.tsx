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
  return (
    <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-full bg-transparent p-0.5">
      {options.map((option) => {
        const isActive = agentType === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${
              isActive
                ? 'bg-accent-primary text-white shadow-[0_8px_20px_rgba(116,79,185,0.28)]'
                : 'border border-border-hairline bg-canvas-raised text-ink-muted hover:border-accent-primary/30 hover:bg-accent-primary-soft/50 hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        )
      })}
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
