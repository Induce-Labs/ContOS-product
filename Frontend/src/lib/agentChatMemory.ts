import { isAgentsWelcomeMessage, type AgentType } from './agentsApi'
import { formatStructuredAgentOutput } from './agentOutputDisplay'
import type { ReplyTarget } from './agentChatStorage'

export type ChatHistoryTurn = {
  role: 'user' | 'assistant'
  content: string
}

type MemorySourceMessage = {
  id?: string
  role: 'user' | 'assistant'
  content: string
  agentType?: AgentType
  output?: unknown
  proposalForPostId?: string
  replyTo?: ReplyTarget
}

const REPLY_EXCERPT_LIMIT = 140

export function replyExcerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= REPLY_EXCERPT_LIMIT) return flat
  return `${flat.slice(0, REPLY_EXCERPT_LIMIT - 1)}…`
}

/** Plain-text tag for one message. Structured output uses its formatted text. */
export function replyTargetForMessage(message: {
  id: string
  role: 'user' | 'assistant'
  content: string
  output?: unknown
}): ReplyTarget | null {
  let source = message.content
  if (message.role === 'assistant' && message.output != null && typeof message.output === 'object') {
    const formatted = formatStructuredAgentOutput(message.output).trim()
    if (formatted) source = formatted
  }
  const excerpt = replyExcerpt(source)
  if (!excerpt) return null
  return { messageId: message.id, role: message.role, excerpt }
}

/** History and the invoke body see the quote. The stored bubble text does not. */
export function userTextWithReply(text: string, replyTo: ReplyTarget | null | undefined): string {
  if (!replyTo?.excerpt) return text
  const who = replyTo.role === 'assistant' ? 'the assistant' : 'you'
  return `Replying to ${who}: "${replyTo.excerpt}"\n\n${text}`
}

const MAX_HISTORY_MESSAGES = 12
const MAX_CONTENT_CHARS = 2000
const MAX_ASSISTANT_CHARS = 5000

function clip(text: string, max = MAX_CONTENT_CHARS): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

function assistantMemoryText(message: MemorySourceMessage): string {
  if (message.output != null && typeof message.output === 'object') {
    const formatted = formatStructuredAgentOutput(message.output).trim()
    if (formatted) return clip(formatted, MAX_ASSISTANT_CHARS)
  }
  return clip(message.content || '', MAX_ASSISTANT_CHARS)
}

const PLATFORM_AGENTS: ReadonlySet<AgentType> = new Set(['linkedin', 'instagram', 'twitter'])

function isOtherPlatformSpecialist(
  turnAgent: AgentType | undefined,
  target: AgentType,
): boolean {
  if (!turnAgent || !PLATFORM_AGENTS.has(target) || !PLATFORM_AGENTS.has(turnAgent)) {
    return false
  }
  return turnAgent !== target
}

/**
 * Build prior turns for the Agents invoke body (excludes the message about to be sent).
 * Skips the seeded welcome bubble and empty / error-only assistants.
 * A specialist call drops turns that belong to a different specialist. Chat turns and
 * turns with no agent stay. Chat itself keeps every turn.
 */
export function buildChatHistoryForInvoke(
  messages: MemorySourceMessage[],
  agentType?: AgentType,
): ChatHistoryTurn[] {
  const turns: ChatHistoryTurn[] = []

  for (const message of messages) {
    if (agentType && isOtherPlatformSpecialist(message.agentType, agentType)) {
      continue
    }
    if (message.role === 'assistant' && message.proposalForPostId) {
      const previous = turns[turns.length - 1]
      if (previous?.role === 'user') turns.pop()
      continue
    }
    if (message.role === 'assistant' && isAgentsWelcomeMessage(message.content)) {
      continue
    }

    if (message.role === 'user') {
      const typed = clip(message.content || '')
      if (!typed) continue
      turns.push({ role: 'user', content: clip(userTextWithReply(typed, message.replyTo)) })
      continue
    }

    const content = assistantMemoryText(message)
    if (!content) continue
    if (content.startsWith('Sorry —')) continue
    turns.push({ role: 'assistant', content })
  }

  return turns.slice(-MAX_HISTORY_MESSAGES)
}
