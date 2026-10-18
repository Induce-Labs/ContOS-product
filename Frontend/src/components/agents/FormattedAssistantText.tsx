import { Fragment } from 'react'
import { parseChatMessage, type ChatInline } from '../../lib/chatMessageFormat'

function InlineNodes({ nodes }: { nodes: ChatInline[] }) {
  return nodes.map((node, index) =>
    node.kind === 'strong' ? (
      <strong key={index} className="font-semibold">
        {node.value}
      </strong>
    ) : (
      <Fragment key={index}>{node.value}</Fragment>
    ),
  )
}

/**
 * Renders assistant chat text as React elements. Incomplete markdown stays
 * literal text. User messages are not passed through this component.
 */
export function FormattedAssistantText({ text }: { text: string }) {
  const blocks = parseChatMessage(text)
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') {
          const Tag = block.level === 3 ? 'h3' : 'h4'
          return (
            <Tag key={index} className="font-semibold text-ink">
              {block.text}
            </Tag>
          )
        }
        if (block.kind === 'divider') {
          return <hr key={index} className="border-0 border-t border-border-hairline" />
        }
        if (block.kind === 'ol') {
          return (
            <ol key={index} start={block.start} className="list-decimal space-y-2 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <InlineNodes nodes={item} />
                </li>
              ))}
            </ol>
          )
        }
        if (block.kind === 'ul') {
          return (
            <ul key={index} className="list-disc space-y-2 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <InlineNodes nodes={item} />
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={index} className="whitespace-pre-wrap">
            <InlineNodes nodes={block.inlines} />
          </p>
        )
      })}
    </div>
  )
}
