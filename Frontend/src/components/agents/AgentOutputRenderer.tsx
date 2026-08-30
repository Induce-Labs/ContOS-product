import type { ReactNode } from 'react'
import type { AgentType } from '../../lib/agentsApi'
import {
  buildInstagramDisplaySections,
} from '../../lib/agentOutputDisplay'

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-accent-primary">
        {title}
      </h4>
      {children}
    </section>
  )
}

function BulletList({ items }: { items: string[] }) {
  if (!items.length) return null
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
      {items.map((item, index) => (
        <li key={`${item.slice(0, 24)}-${index}`}>{item}</li>
      ))}
    </ul>
  )
}

function InstagramOutputView({ output }: { output: UnknownRecord }) {
  const sections = buildInstagramDisplaySections(output)
  const calendar = Array.isArray(output.content_calendar) ? output.content_calendar : []
  const competitors = Array.isArray(output.competitor_comparison)
    ? output.competitor_comparison
    : []

  // Prefer richer card UI when calendar/competitor rows exist; otherwise section list.
  if (calendar.length === 0 && competitors.length === 0) {
    return (
      <div className="space-y-4">
        {sections.map((section) => (
          <Section key={section.title} title={section.title}>
            {section.body ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {section.body}
              </p>
            ) : null}
            {section.items?.length ? <BulletList items={section.items} /> : null}
          </Section>
        ))}
        {!sections.length ? (
          <p className="text-sm text-ink-muted">No Instagram strategy content returned.</p>
        ) : null}
      </div>
    )
  }

  const analysis = asString(output.analysis)
  const comparisonSummary = asString(output.comparison_summary)
  const topHooks = asStringList(output.top_hooks)
  const captionFormulas = asStringList(output.caption_formulas)
  const postingFrequency = asString(output.posting_frequency)
  const differentiation = asStringList(output.differentiation_angles)

  return (
    <div className="space-y-4">
      {analysis ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{analysis}</p>
      ) : null}
      {comparisonSummary ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {comparisonSummary}
        </p>
      ) : null}
      {competitors.length > 0 ? (
        <Section title="Competitor insights">
          <div className="space-y-3">
            {competitors.map((raw, index) => {
              const card = asRecord(raw) ?? {}
              const handle = asString(card.competitor_handle) || `Competitor ${index + 1}`
              return (
                <article
                  key={`${handle}-${index}`}
                  className="rounded-xl border border-border-hairline bg-canvas-raised px-3 py-3"
                >
                  <p className="text-xs uppercase tracking-wide text-ink-muted">
                    {asString(card.platform) || 'instagram'}
                  </p>
                  <h5 className="mt-1 font-medium text-ink">{handle}</h5>
                  <div className="mt-2 space-y-2">
                    {asStringList(card.key_signals).length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-ink-muted">Key signals</p>
                        <BulletList items={asStringList(card.key_signals)} />
                      </div>
                    ) : null}
                    {asStringList(card.hooks_and_themes).length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-ink-muted">Hooks & themes</p>
                        <BulletList items={asStringList(card.hooks_and_themes)} />
                      </div>
                    ) : null}
                    {asStringList(card.strengths).length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-ink-muted">Strengths</p>
                        <BulletList items={asStringList(card.strengths)} />
                      </div>
                    ) : null}
                    {asStringList(card.weaknesses).length > 0 ? (
                      <div>
                        <p className="text-xs font-medium text-ink-muted">Weaknesses</p>
                        <BulletList items={asStringList(card.weaknesses)} />
                      </div>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        </Section>
      ) : null}
      {calendar.length > 0 ? (
        <Section title="Content calendar">
          <div className="space-y-3">
            {calendar.map((raw, index) => {
              const row = asRecord(raw) ?? {}
              const contentType = asString(row.content_type) || 'Post'
              const day = typeof row.day === 'number' ? row.day : index + 1
              return (
                <article
                  key={`day-${day}-${index}`}
                  className="rounded-xl border border-border-hairline bg-canvas-raised px-3 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <span>Day {day}</span>
                    {asString(row.date) ? <span>· {asString(row.date)}</span> : null}
                    <span className="rounded-md bg-accent-primary-soft px-2 py-0.5 font-medium text-accent-primary">
                      {contentType}
                    </span>
                  </div>
                  {asString(row.hook) ? (
                    <p className="mt-2 font-medium text-ink">{asString(row.hook)}</p>
                  ) : null}
                  {asString(row.caption) ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
                      {asString(row.caption)}
                    </p>
                  ) : null}
                  {asStringList(row.hashtags).length > 0 ? (
                    <p className="mt-2 text-xs text-accent-primary">
                      {asStringList(row.hashtags)
                        .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
                        .join(' ')}
                    </p>
                  ) : null}
                  {asString(row.cta) ? (
                    <p className="mt-2 text-sm text-ink">CTA: {asString(row.cta)}</p>
                  ) : null}
                  {asString(row.reasoning) ? (
                    <p className="mt-2 border-t border-border-hairline pt-2 text-xs text-ink-muted">
                      Why: {asString(row.reasoning)}
                    </p>
                  ) : null}
                </article>
              )
            })}
          </div>
        </Section>
      ) : null}
      {topHooks.length > 0 ? (
        <Section title="Top hooks">
          <BulletList items={topHooks} />
        </Section>
      ) : null}
      {captionFormulas.length > 0 ? (
        <Section title="Caption formulas">
          <BulletList items={captionFormulas} />
        </Section>
      ) : null}
      {postingFrequency ? (
        <Section title="Posting cadence">
          <p className="text-sm text-ink">{postingFrequency}</p>
        </Section>
      ) : null}
      {differentiation.length > 0 ? (
        <Section title="How to differentiate">
          <BulletList items={differentiation} />
        </Section>
      ) : null}
    </div>
  )
}

function LinkedInOutputView({ output }: { output: UnknownRecord }) {
  const ideas = Array.isArray(output.post_ideas) ? output.post_ideas : []
  const themes = asStringList(output.thought_leadership_themes)
  const hooks = asStringList(output.hook_formulas)
  const frequency = asString(output.posting_frequency)

  return (
    <div className="space-y-4">
      {ideas.length > 0 ? (
        <Section title="Post ideas">
          <div className="space-y-3">
            {ideas.map((raw, index) => {
              const idea = asRecord(raw) ?? {}
              return (
                <article
                  key={`li-${index}`}
                  className="rounded-xl border border-border-hairline bg-canvas-raised px-3 py-3"
                >
                  <p className="text-xs uppercase tracking-wide text-accent-primary">
                    {asString(idea.content_type) || 'Post'}
                  </p>
                  <h5 className="mt-1 font-medium text-ink">
                    {asString(idea.topic) || `Idea ${index + 1}`}
                  </h5>
                  {asString(idea.hook) ? (
                    <p className="mt-2 font-medium text-ink">{asString(idea.hook)}</p>
                  ) : null}
                  {asString(idea.post_structure) ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
                      {asString(idea.post_structure)}
                    </p>
                  ) : null}
                  {asString(idea.cta) ? (
                    <p className="mt-2 text-sm text-ink">CTA: {asString(idea.cta)}</p>
                  ) : null}
                  {asString(idea.reasoning) ? (
                    <p className="mt-2 border-t border-border-hairline pt-2 text-xs text-ink-muted">
                      Why: {asString(idea.reasoning)}
                    </p>
                  ) : null}
                </article>
              )
            })}
          </div>
        </Section>
      ) : null}
      {themes.length > 0 ? (
        <Section title="Themes">
          <BulletList items={themes} />
        </Section>
      ) : null}
      {hooks.length > 0 ? (
        <Section title="Hook formulas">
          <BulletList items={hooks} />
        </Section>
      ) : null}
      {frequency ? (
        <Section title="Posting cadence">
          <p className="text-sm text-ink">{frequency}</p>
        </Section>
      ) : null}
    </div>
  )
}

function PlaybookOutputView({ output }: { output: UnknownRecord }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-ink-muted">Audit</span>
        <span className="rounded-md bg-accent-primary-soft px-2 py-0.5 text-xs font-semibold text-accent-primary">
          {asString(output.audit_result) || 'N/A'}
        </span>
      </div>
      {asStringList(output.strategy_frameworks).length > 0 ? (
        <Section title="Strategy frameworks">
          <BulletList items={asStringList(output.strategy_frameworks)} />
        </Section>
      ) : null}
      {asStringList(output.guardrails).length > 0 ? (
        <Section title="Guardrails">
          <BulletList items={asStringList(output.guardrails)} />
        </Section>
      ) : null}
      {asStringList(output.recommendations).length > 0 ? (
        <Section title="Recommendations">
          <BulletList items={asStringList(output.recommendations)} />
        </Section>
      ) : null}
      {asStringList(output.broken_rules).length > 0 ? (
        <Section title="Broken rules">
          <BulletList items={asStringList(output.broken_rules)} />
        </Section>
      ) : null}
      {asString(output.reasoning) ? (
        <p className="whitespace-pre-wrap border-t border-border-hairline pt-3 text-sm text-ink-muted">
          {asString(output.reasoning)}
        </p>
      ) : null}
    </div>
  )
}

function TwitterOutputView({ output }: { output: UnknownRecord }) {
  const tweets = Array.isArray(output.tweet_ideas) ? output.tweet_ideas : []
  const formulas = asStringList(output.hook_formulas)
  const tactics = asStringList(output.engagement_tactics)
  const frequency = asString(output.posting_frequency)

  return (
    <div className="space-y-4">
      {tweets.length > 0 ? (
        <Section title="Tweet ideas">
          <div className="space-y-3">
            {tweets.map((raw, index) => {
              const tweet = asRecord(raw) ?? {}
              return (
                <article
                  key={`tw-${index}`}
                  className="rounded-xl border border-border-hairline bg-canvas-raised px-3 py-3"
                >
                  <p className="text-xs uppercase tracking-wide text-accent-primary">
                    {asString(tweet.type) || 'Tweet'}
                  </p>
                  {asString(tweet.hook) ? (
                    <p className="mt-2 font-medium text-ink">{asString(tweet.hook)}</p>
                  ) : null}
                  {asString(tweet.full_tweet) ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
                      {asString(tweet.full_tweet)}
                    </p>
                  ) : null}
                  {asString(tweet.reasoning) ? (
                    <p className="mt-2 border-t border-border-hairline pt-2 text-xs text-ink-muted">
                      Why: {asString(tweet.reasoning)}
                    </p>
                  ) : null}
                </article>
              )
            })}
          </div>
        </Section>
      ) : null}
      {formulas.length > 0 ? (
        <Section title="Hook formulas">
          <BulletList items={formulas} />
        </Section>
      ) : null}
      {tactics.length > 0 ? (
        <Section title="Engagement tactics">
          <BulletList items={tactics} />
        </Section>
      ) : null}
      {frequency ? (
        <Section title="Posting cadence">
          <p className="text-sm text-ink">{frequency}</p>
        </Section>
      ) : null}
    </div>
  )
}

export function AgentOutputRenderer({
  agentType,
  output,
  streamingText,
}: {
  agentType?: AgentType
  output: unknown
  streamingText?: string
}) {
  if (typeof output === 'string' && output.trim()) {
    return <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{output}</p>
  }

  const record = asRecord(output)
  if (record) {
    if (record.error && (record.display_text || record.raw_response_excerpt)) {
      return (
        <div className="space-y-2">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Couldn’t parse structured output — showing the raw response. Try asking again with a
            narrower request.
          </p>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border-hairline bg-canvas px-3 py-2 text-xs text-ink-muted">
            {asString(record.display_text) || asString(record.raw_response_excerpt)}
          </pre>
        </div>
      )
    }

    const agent =
      agentType ||
      (asString(record.agent) as AgentType | '') ||
      'chatbot'

    if (agent === 'instagram') return <InstagramOutputView output={record} />
    if (agent === 'linkedin') return <LinkedInOutputView output={record} />
    if (agent === 'playbook') return <PlaybookOutputView output={record} />
    if (agent === 'twitter') return <TwitterOutputView output={record} />
  }

  if (streamingText?.trim()) {
    return (
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{streamingText}</p>
    )
  }

  return <p className="text-sm text-ink-muted">No response yet.</p>
}
