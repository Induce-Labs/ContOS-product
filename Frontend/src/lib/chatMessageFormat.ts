/**
 * Dependency-free display parser for assistant chat text.
 * It only recognizes structure the model already sent. Wording is unchanged.
 */

export type ChatInline =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; value: string }

export type ChatBlock =
  | { kind: 'paragraph'; inlines: ChatInline[] }
  | { kind: 'heading'; level: 3 | 4; text: string }
  | { kind: 'ol'; start: number; items: ChatInline[][] }
  | { kind: 'ul'; items: ChatInline[][] }

type Classified =
  | { type: 'blank' }
  | { type: 'plain'; text: string }
  | { type: 'ol'; n: number; text: string }
  | { type: 'ul'; text: string }
  | { type: 'heading'; level: 3 | 4; text: string }
  | { type: 'para'; text: string }

/** Closed `**phrase**` becomes strong. An unclosed `**` stays literal text. */
export function parseChatInlines(input: string): ChatInline[] {
  const nodes: ChatInline[] = []
  let buffer = ''
  let index = 0
  while (index < input.length) {
    if (input.startsWith('**', index)) {
      const close = input.indexOf('**', index + 2)
      if (close === -1) {
        buffer += input.slice(index)
        break
      }
      if (buffer) nodes.push({ kind: 'text', value: buffer })
      buffer = ''
      nodes.push({ kind: 'strong', value: input.slice(index + 2, close) })
      index = close + 2
      continue
    }
    buffer += input[index]
    index += 1
  }
  if (buffer) nodes.push({ kind: 'text', value: buffer })
  return nodes.length ? nodes : [{ kind: 'text', value: '' }]
}

function classifyLine(line: string): Classified {
  if (!line.trim()) return { type: 'blank' }
  const trimmed = line.trim()

  // A marker with no item text yet is still streaming. Keep it literal.
  if (/^\d+\.?$/.test(trimmed) || /^[-*]$/.test(trimmed)) {
    return { type: 'plain', text: trimmed }
  }

  const numbered = /^(\d+)\.\s+(\S[\s\S]*)$/.exec(trimmed)
  if (numbered) {
    return { type: 'ol', n: Number(numbered[1]), text: numbered[2].trim() }
  }

  const bullet = /^[-*]\s+(\S[\s\S]*)$/.exec(trimmed)
  if (bullet) return { type: 'ul', text: bullet[1].trim() }

  const heading = /^(#{1,6})\s+(\S[\s\S]*)$/.exec(trimmed)
  if (heading) {
    return {
      type: 'heading',
      level: heading[1].length <= 2 ? 3 : 4,
      text: heading[2].trim(),
    }
  }

  const onlyBold = /^\*\*([^*][\s\S]*?)\*\*$/.exec(trimmed)
  if (onlyBold && onlyBold[1].trim() && !onlyBold[1].includes('**')) {
    return { type: 'heading', level: 4, text: onlyBold[1].trim() }
  }

  return { type: 'para', text: trimmed }
}

/**
 * Turn assistant text into blocks. A reply with no lists, headings, or blank
 * lines stays one paragraph. Numbered items separated only by blank lines
 * stay one list, and `start` is the first item's number.
 */
export function parseChatMessage(source: string): ChatBlock[] {
  const text = source.replace(/\r\n/g, '\n')
  const lines = text.split('\n').map(classifyLine)
  const content = lines.filter((line) => line.type !== 'blank')
  const hasStructure = content.some(
    (line) => line.type === 'ol' || line.type === 'ul' || line.type === 'heading' || line.type === 'plain',
  )
  const hasBlank = lines.some((line) => line.type === 'blank') && content.length > 0

  if (!hasStructure && !hasBlank) {
    const joined = content
      .filter((line): line is { type: 'para'; text: string } => line.type === 'para')
      .map((line) => line.text)
      .join('\n')
    return [{ kind: 'paragraph', inlines: parseChatInlines(joined) }]
  }

  const blocks: ChatBlock[] = []
  let paragraph: string[] = []
  let ordered: { start: number; items: string[] } | null = null
  let bullets: string[] = []

  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push({ kind: 'paragraph', inlines: parseChatInlines(paragraph.join('\n')) })
    paragraph = []
  }
  const flushOrdered = () => {
    if (!ordered) return
    blocks.push({
      kind: 'ol',
      start: ordered.start,
      items: ordered.items.map((item) => parseChatInlines(item)),
    })
    ordered = null
  }
  const flushBullets = () => {
    if (!bullets.length) return
    blocks.push({ kind: 'ul', items: bullets.map((item) => parseChatInlines(item)) })
    bullets = []
  }
  const flushAll = () => {
    flushParagraph()
    flushOrdered()
    flushBullets()
  }

  let pendingBlank = false
  for (const line of lines) {
    if (line.type === 'blank') {
      flushParagraph()
      flushBullets()
      if (ordered) pendingBlank = true
      continue
    }
    if (line.type === 'ol') {
      flushParagraph()
      flushBullets()
      if (!ordered) ordered = { start: line.n, items: [] }
      ordered.items.push(line.text)
      pendingBlank = false
      continue
    }
    if (pendingBlank) {
      flushOrdered()
      pendingBlank = false
    }
    if (line.type === 'ul') {
      flushParagraph()
      flushOrdered()
      bullets.push(line.text)
      continue
    }
    if (line.type === 'heading') {
      flushAll()
      blocks.push({ kind: 'heading', level: line.level, text: line.text })
      continue
    }
    flushOrdered()
    flushBullets()
    paragraph.push(line.text)
  }
  flushAll()
  return blocks.length ? blocks : [{ kind: 'paragraph', inlines: [{ kind: 'text', value: '' }] }]
}
