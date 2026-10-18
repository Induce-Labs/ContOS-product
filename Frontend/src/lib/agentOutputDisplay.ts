/**
 * Pure helpers for turning structured agent JSON into readable display sections.
 * Used by AgentOutputRenderer and by unit tests (no React dependency).
 */

export type DisplaySection = {
  title: string
  body?: string
  items?: string[]
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as UnknownRecord
  }
  return null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      if (item == null) return ''
      try {
        return JSON.stringify(item)
      } catch {
        return String(item)
      }
    })
    .filter(Boolean)
}

/** True when a message should be rendered as structured UI, not raw streamed text. */
export function isStructuredAgentOutput(output: unknown): boolean {
  const record = asRecord(output)
  if (!record) return false
  if (typeof record.agent === 'string' && record.agent !== 'chatbot') return true
  return Boolean(
    record.response_type ||
      record.content_calendar ||
      record.post_ideas ||
      record.tweet_ideas ||
      record.strategy_frameworks,
  )
}

/** Build ordered display sections for Instagram (and generic structured) payloads. */
export function buildInstagramDisplaySections(output: unknown): DisplaySection[] {
  const record = asRecord(output)
  if (!record) return []

  const sections: DisplaySection[] = []
  const analysis = asString(record.analysis)
  if (analysis) {
    sections.push({ title: 'Strategy', body: analysis })
  }

  const comparisonSummary = asString(record.comparison_summary)
  if (comparisonSummary) {
    sections.push({ title: 'Comparison summary', body: comparisonSummary })
  }

  const competitors = Array.isArray(record.competitor_comparison)
    ? record.competitor_comparison
    : []
  for (const [index, raw] of competitors.entries()) {
    const card = asRecord(raw) ?? {}
    const handle = asString(card.competitor_handle) || `Competitor ${index + 1}`
    const items = [
      ...asStringList(card.key_signals).map((s) => `Signal: ${s}`),
      ...asStringList(card.hooks_and_themes).map((s) => `Theme: ${s}`),
      ...asStringList(card.strengths).map((s) => `Strength: ${s}`),
      ...asStringList(card.weaknesses).map((s) => `Weakness: ${s}`),
    ]
    if (items.length) {
      sections.push({ title: handle, items })
    }
  }

  const calendar = Array.isArray(record.content_calendar) ? record.content_calendar : []
  for (const [index, raw] of calendar.entries()) {
    const row = asRecord(raw) ?? {}
    const day = typeof row.day === 'number' ? row.day : index + 1
    const parts = [
      asString(row.content_type),
      asString(row.hook),
      asString(row.caption),
    ].filter(Boolean)
    if (parts.length) {
      sections.push({ title: `Day ${day}`, body: parts.join('\n') })
    }
  }

  const topHooks = asStringList(record.top_hooks)
  if (topHooks.length) sections.push({ title: 'Top hooks', items: topHooks })

  const captionFormulas = asStringList(record.caption_formulas)
  if (captionFormulas.length) {
    sections.push({ title: 'Caption formulas', items: captionFormulas })
  }

  const postingFrequency = asString(record.posting_frequency)
  if (postingFrequency) {
    sections.push({ title: 'Posting cadence', body: postingFrequency })
  }

  const differentiation = asStringList(record.differentiation_angles)
  if (differentiation.length) {
    sections.push({ title: 'How to differentiate', items: differentiation })
  }

  return sections
}

export type PublishablePost = {
  hook?: string
  body?: string
  cta?: string
}

/** One paste-ready post. The hook is not repeated when the body already opens with it. */
export function composePublishablePost(post: PublishablePost): string {
  const hook = (post.hook ?? '').trim()
  const body = (post.body ?? '').trim()
  const cta = (post.cta ?? '').trim()
  let text = body
  if (hook) {
    const firstLine = text.split('\n')[0]?.trim() ?? ''
    if (firstLine !== hook) text = text ? `${hook}\n${text}` : hook
  }
  if (cta && !text.trimEnd().endsWith(cta)) {
    text = text ? `${text}\n${cta}` : cta
  }
  // Model bodies often put a blank line between every sentence; keep single newlines only.
  return text.replace(/\n{2,}/g, '\n').trim()
}

/** Ordered list of non-empty drafts for on-screen rendering. */
export function composePublishablePostList(posts: PublishablePost[]): string[] {
  return posts.map((post) => composePublishablePost(post).trim()).filter(Boolean)
}

/** Several posts joined for saved/history text (no dash divider). */
export function composePublishablePosts(posts: PublishablePost[]): string {
  return composePublishablePostList(posts).join('\n\n')
}

function formatSections(sections: DisplaySection[]): string {
  return sections
    .map((section) => {
      const lines = [`## ${section.title}`]
      if (section.body) lines.push(section.body)
      if (section.items?.length) {
        for (const item of section.items) lines.push(`- ${item}`)
      }
      return lines.join('\n')
    })
    .join('\n\n')
}

/** Flatten sections to plain text (never a JSON dump of the whole payload). */
/** Reply, thesis, ideas and the full draft text, so the next turn can build on them. */
function formatStrategistOutput(record: Record<string, unknown>): string {
  if (typeof record.mode !== 'string') return ''
  const parts: string[] = []
  const reply = asString(record.reply)
  if (reply) parts.push(reply)
  const thesis = asString(record.thesis)
  if (thesis) parts.push(`Angle: ${thesis}`)
  const ideas = Array.isArray(record.ideas) ? record.ideas : []
  for (const raw of ideas) {
    const idea = asRecord(raw) ?? {}
    const title = asString(idea.title)
    if (title) parts.push(`- ${title}: ${asString(idea.why)}`.trim())
  }
  const drafts: Array<[string, string]> = []
  for (const raw of Array.isArray(record.post_ideas) ? record.post_ideas : []) {
    const item = asRecord(raw) ?? {}
    drafts.push([asString(item.topic), asString(item.post_structure) || asString(item.hook)])
  }
  for (const raw of Array.isArray(record.tweet_ideas) ? record.tweet_ideas : []) {
    const item = asRecord(raw) ?? {}
    drafts.push([asString(item.type), asString(item.full_tweet) || asString(item.hook)])
  }
  for (const raw of Array.isArray(record.content_calendar) ? record.content_calendar : []) {
    const item = asRecord(raw) ?? {}
    drafts.push([asString(item.day) ? `Day ${asString(item.day)}` : '', asString(item.copy_paste_post) || asString(item.caption)])
  }
  for (const [label, text] of drafts) {
    if (text) parts.push(`${label ? `Draft (${label})` : 'Draft'}:\n${text}`)
  }
  const question = asString(record.next_question)
  if (question) parts.push(question)
  return parts.join('\n\n')
}

export function formatStructuredAgentOutput(output: unknown): string {
  if (typeof output === 'string') return output
  const record = asRecord(output)
  if (!record) return ''

  const strategist = formatStrategistOutput(record)
  if (strategist) return strategist

  const agent = asString(record.agent)
  let sections = buildInstagramDisplaySections(output)

  if (!sections.length && (agent === 'linkedin' || Array.isArray(record.post_ideas))) {
    const ideas = Array.isArray(record.post_ideas) ? record.post_ideas : []
    const composed = composePublishablePosts(
      ideas.map((raw) => {
        const idea = asRecord(raw) ?? {}
        return {
          hook: asString(idea.hook),
          body: asString(idea.post_structure),
          cta: asString(idea.cta),
        }
      }),
    )
    const extras: DisplaySection[] = []
    const themes = asStringList(record.thought_leadership_themes)
    if (themes.length) extras.push({ title: 'Themes', items: themes })
    const hookFormulas = asStringList(record.hook_formulas)
    if (hookFormulas.length) extras.push({ title: 'Hook formulas', items: hookFormulas })
    const postingFrequency = asString(record.posting_frequency)
    if (postingFrequency) extras.push({ title: 'Posting cadence', body: postingFrequency })
    const extra = extras.length ? formatSections(extras) : ''
    if (composed || extra) return [composed, extra].filter(Boolean).join('\n\n')
  }

  if (!sections.length && (agent === 'twitter' || Array.isArray(record.tweet_ideas))) {
    const tweets = Array.isArray(record.tweet_ideas) ? record.tweet_ideas : []
    const composed = composePublishablePosts(
      tweets.map((raw) => {
        const tweet = asRecord(raw) ?? {}
        return {
          hook: asString(tweet.hook),
          body: asString(tweet.full_tweet),
        }
      }),
    )
    const extras: DisplaySection[] = []
    const formulas = asStringList(record.hook_formulas)
    if (formulas.length) extras.push({ title: 'Hook formulas', items: formulas })
    const tactics = asStringList(record.engagement_tactics)
    if (tactics.length) extras.push({ title: 'Engagement tactics', items: tactics })
    const postingFrequency = asString(record.posting_frequency)
    if (postingFrequency) extras.push({ title: 'Posting cadence', body: postingFrequency })
    const extra = extras.length ? formatSections(extras) : ''
    if (composed || extra) return [composed, extra].filter(Boolean).join('\n\n')
  }

  if (
    !sections.length &&
    (agent === 'playbook' ||
      Array.isArray(record.strategy_frameworks) ||
      Array.isArray(record.recommendations))
  ) {
    const frameworks = asStringList(record.strategy_frameworks)
    const recs = asStringList(record.recommendations)
    if (frameworks.length) sections.push({ title: 'Frameworks', items: frameworks })
    if (recs.length) sections.push({ title: 'Recommendations', items: recs })
    const reasoning = asString(record.reasoning)
    if (reasoning) sections.push({ title: 'Reasoning', body: reasoning })
  }

  if (!sections.length) {
    if (record.display_text || record.raw_response_excerpt) {
      return asString(record.display_text) || asString(record.raw_response_excerpt)
    }
    return ''
  }
  return formatSections(sections)
}
