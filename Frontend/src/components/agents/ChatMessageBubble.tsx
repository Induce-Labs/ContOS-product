import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { ReplyIcon } from '../icons/ActionIcons'
import contosMark from '../../assets/contos-mark.png'
import contosMarkDark from '../../assets/image.png'
import { AgentOutputRenderer } from './AgentOutputRenderer'
import { FormattedAssistantText } from './FormattedAssistantText'
import type { AgentType } from '../../lib/agentsApi'
import type { ReplyTarget } from '../../lib/agentChatStorage'

type ChatMessageBubbleProps = {
  role: 'user' | 'assistant'
  content: string
  taggedAvatarNames?: string[]
  agentType?: AgentType
  structuredOutput?: unknown | null
  avatarId?: string
  replyTo?: ReplyTarget
  draftPreview?: { label: string; excerpt: string }
  onReply?: () => void
  onJumpToReply?: (messageId: string) => void
  footer?: ReactNode
}

export function ChatMessageBubble({
  role,
  content,
  taggedAvatarNames,
  agentType,
  structuredOutput,
  avatarId,
  replyTo,
  draftPreview,
  onReply,
  onJumpToReply,
  footer,
}: ChatMessageBubbleProps) {
  const { t } = useTranslation()
  const isUser = role === 'user'

  const bubble = (
    <div
      className={`max-w-[min(100%,36rem)] rounded-2xl px-4 py-3 text-sm leading-relaxed text-ink ${
        isUser
          ? 'whitespace-pre-wrap bg-accent-primary-soft'
          : 'border border-border-hairline bg-canvas-raised'
      }`}
    >
      {draftPreview ? (
        <div className="mb-2 rounded-lg border-l-2 border-accent-primary-deep/70 bg-canvas/70 px-2 py-1 text-left">
          <p className="text-[11px] font-medium text-ink-muted">{draftPreview.label}</p>
          <p className="line-clamp-4 whitespace-pre-wrap text-xs text-ink">{draftPreview.excerpt}</p>
        </div>
      ) : null}
      {replyTo ? (
        <button
          type="button"
          className="mb-2 block max-w-full truncate rounded-lg border-l-2 border-accent-primary-deep/70 bg-canvas/70 px-2 py-1 text-left text-xs text-ink-muted"
          onClick={() => onJumpToReply?.(replyTo.messageId)}
        >
          {replyTo.excerpt}
        </button>
      ) : null}
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
        <AgentOutputRenderer
          agentType={agentType}
          output={structuredOutput}
          avatarId={avatarId}
        />
      ) : isUser ? (
        content
      ) : (
        <FormattedAssistantText text={content} />
      )}
    </div>
  )

  const replyButton = onReply ? (
    <button
      type="button"
      onClick={onReply}
      aria-label={t('agents.reply.action')}
      className="mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-ink-muted transition hover:bg-canvas hover:text-ink"
    >
      <ReplyIcon />
    </button>
  ) : null

  if (isUser) {
    return (
      <div className="group flex flex-col items-end">
        {bubble}
        {replyButton}
      </div>
    )
  }

  return (
    <div className="group flex items-end justify-start gap-2.5">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas-raised shadow-[0_2px_8px_rgba(28,27,41,0.06)] ring-1 ring-border-hairline">
        <img src={contosMark} alt="" aria-hidden className="h-5 w-5 object-contain dark:hidden" />
        <img src={contosMarkDark} alt="" aria-hidden className="hidden h-5 w-5 object-contain dark:block" />
      </span>
      <div className="flex min-w-0 flex-col items-start">
        {bubble}
        {footer}
        {replyButton}
      </div>
    </div>
  )
}
