import contosMark from '../../assets/contos-mark.png'
import { AgentOutputRenderer } from './AgentOutputRenderer'
import type { AgentType } from '../../lib/agentsApi'

type ChatMessageBubbleProps = {
  role: 'user' | 'assistant'
  content: string
  taggedAvatarNames?: string[]
  agentType?: AgentType
  structuredOutput?: unknown | null
}

export function ChatMessageBubble({
  role,
  content,
  taggedAvatarNames,
  agentType,
  structuredOutput,
}: ChatMessageBubbleProps) {
  const isUser = role === 'user'

  const bubble = (
    <div
      className={`max-w-[min(100%,36rem)] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-ink ${
        isUser
          ? 'bg-accent-primary-soft'
          : 'border border-border-hairline bg-canvas-raised'
      }`}
    >
      {taggedAvatarNames && taggedAvatarNames.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1">
          {taggedAvatarNames.map((name) => (
            <span
              key={name}
              className="rounded-full bg-accent-primary/15 px-2 py-0.5 text-[11px] font-medium text-accent-primary-deep"
            >
              {name}
            </span>
          ))}
        </div>
      ) : null}
      {structuredOutput ? (
        <AgentOutputRenderer agentType={agentType} output={structuredOutput} />
      ) : (
        content
      )}
    </div>
  )

  if (isUser) {
    return <div className="flex justify-end">{bubble}</div>
  }

  return (
    <div className="flex items-end justify-start gap-2.5">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas-raised shadow-[0_2px_8px_rgba(28,27,41,0.06)] ring-1 ring-border-hairline">
        <img src={contosMark} alt="" aria-hidden className="h-5 w-5 object-contain" />
      </span>
      {bubble}
    </div>
  )
}
