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

/** Flatten sections to plain text (never a JSON dump of the whole payload). */
export function formatStructuredAgentOutput(output: unknown): string {
  if (typeof output === 'string') return output
  const record = asRecord(output)
  if (!record) return ''

  const agent = asString(record.agent)
  let sections = buildInstagramDisplaySections(output)

  if (!sections.length && (agent === 'linkedin' || Array.isArray(record.post_ideas))) {
    const ideas = Array.isArray(record.post_ideas) ? record.post_ideas : []
    const ideaLines = ideas
      .slice(0, 6)
      .map((raw, i) => {
        const idea = asRecord(raw) ?? {}
        const topic = asString(idea.topic) || `Idea ${i + 1}`
        const hook = asString(idea.hook)
        return hook ? `${topic}: ${hook}` : topic
      })
      .filter(Boolean)
    if (ideaLines.length) sections.push({ title: 'LinkedIn ideas', items: ideaLines })
    const themes = asStringList(record.thought_leadership_themes)
    if (themes.length) sections.push({ title: 'Themes', items: themes })
  }

  if (!sections.length && (agent === 'twitter' || Array.isArray(record.tweet_ideas))) {
    const tweets = Array.isArray(record.tweet_ideas) ? record.tweet_ideas : []
    const lines = tweets
      .slice(0, 6)
      .map((raw) => {
        const t = asRecord(raw) ?? {}
        return asString(t.full_tweet) || asString(t.hook)
      })
      .filter(Boolean)
    if (lines.length) sections.push({ title: 'Tweet ideas', items: lines })
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
