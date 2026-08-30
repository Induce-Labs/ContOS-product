import { AGENTS_WELCOME_MESSAGE, type AgentType } from './agentsApi'
import { formatStructuredAgentOutput } from './agentOutputDisplay'

export type ChatHistoryTurn = {
  role: 'user' | 'assistant'
  content: string
}

type MemorySourceMessage = {
  role: 'user' | 'assistant'
  content: string
  agentType?: AgentType
  output?: unknown
}

const MAX_HISTORY_MESSAGES = 12
const MAX_CONTENT_CHARS = 2000

function clip(text: string): string {
  const t = text.trim()
  if (t.length <= MAX_CONTENT_CHARS) return t
  return `${t.slice(0, MAX_CONTENT_CHARS - 1)}…`
}

function assistantMemoryText(message: MemorySourceMessage): string {
  if (message.output != null && typeof message.output === 'object') {
    const formatted = formatStructuredAgentOutput(message.output).trim()
    if (formatted) return clip(formatted)
  }
  return clip(message.content || '')
}

/**
 * Build prior turns for the Agents invoke body (excludes the message about to be sent).
 * Skips the seeded welcome bubble and empty / error-only assistants.
 */
export function buildChatHistoryForInvoke(
  messages: MemorySourceMessage[],
): ChatHistoryTurn[] {
  const turns: ChatHistoryTurn[] = []

  for (const message of messages) {
    if (message.role === 'assistant' && message.content === AGENTS_WELCOME_MESSAGE) {
      continue
    }

    if (message.role === 'user') {
      const content = clip(message.content || '')
      if (!content) continue
      turns.push({ role: 'user', content })
      continue
    }

    const content = assistantMemoryText(message)
    if (!content) continue
    if (content.startsWith('Sorry —')) continue
    turns.push({ role: 'assistant', content })
  }

  return turns.slice(-MAX_HISTORY_MESSAGES)
}
