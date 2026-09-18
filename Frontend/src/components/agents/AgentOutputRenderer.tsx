import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
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
      <h4 className="text-xs font-semibold uppercase tracking-wide text-accent-primary-deep">
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

function translateKnownSectionTitle(title: string, t: TFunction): string {
  const known: Record<string, string> = {
    Strategy: t('agents.output.strategy'),
    'Comparison summary': t('agents.output.comparisonSummary'),
    'Top hooks': t('agents.output.topHooks'),
    'Caption formulas': t('agents.output.captionFormulas'),
    'Posting cadence': t('agents.output.postingCadence'),
    'How to differentiate': t('agents.output.howToDifferentiate'),
    'Post ideas': t('agents.output.postIdeas'),
    Themes: t('agents.output.themes'),
    'Hook formulas': t('agents.output.hookFormulas'),
    'LinkedIn ideas': t('agents.output.linkedinIdeas'),
    'Tweet ideas': t('agents.output.tweetIdeas'),
    'Engagement tactics': t('agents.output.engagementTactics'),
    'Strategy frameworks': t('agents.output.strategyFrameworks'),
    Frameworks: t('agents.output.frameworks'),
    Guardrails: t('agents.output.guardrails'),
    Recommendations: t('agents.output.recommendations'),
    'Broken rules': t('agents.output.brokenRules'),
    Reasoning: t('agents.output.reasoning'),
    'Competitor insights': t('agents.output.competitorInsights'),
    'Content calendar': t('agents.output.contentCalendar'),
    'Key signals': t('agents.output.keySignals'),
    'Hooks & themes': t('agents.output.hooksThemes'),
    Strengths: t('agents.output.strengths'),
    Weaknesses: t('agents.output.weaknesses'),
  }
  if (known[title]) return known[title]
  const dayMatch = /^Day (\d+)$/.exec(title)
  if (dayMatch) return t('agents.output.day', { n: dayMatch[1] })
  return title
}

function InstagramSectionsView({ output }: { output: UnknownRecord }) {
  const { t } = useTranslation()
  const sections = useMemo(() => buildInstagramDisplaySections(output), [output])

  return (
    <div className="space-y-4">
      {sections.map((section, index) => (
        <Section
          key={`${section.title}-${index}`}
          title={translateKnownSectionTitle(section.title, t)}
        >
          {section.body ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {section.body}
            </p>
          ) : null}
          {section.items?.length ? <BulletList items={section.items} /> : null}
        </Section>
      ))}
      {!sections.length ? (
        <p className="text-sm text-ink-muted">{t('agents.output.noInstagramContent')}</p>
      ) : null}
    </div>
  )
}

function InstagramRichOutputView({ output }: { output: UnknownRecord }) {
  const { t } = useTranslation()
  const calendar = Array.isArray(output.content_calendar) ? output.content_calendar : []
  const competitors = Array.isArray(output.competitor_comparison)
    ? output.competitor_comparison
    : []

  const analysis = asString(output.analysis)
  const comparisonSummary = asString(output.comparison_summary)
  const topHooks = asStringList(output.top_hooks)
  const captionFormulas = asStringList(output.caption_formulas)
  const postingFrequency = asString(output.posting_frequency)
  const differentiation = asStringList(output.differentiation_angles)

  const competitorCards = competitors.map((raw, index) => {
    const card = asRecord(raw) ?? {}
    return {
      handle: asString(card.competitor_handle) || t('agents.output.competitorN', { n: index + 1 }),
      platform: asString(card.platform) || 'instagram',
      keySignals: asStringList(card.key_signals),
      hooksThemes: asStringList(card.hooks_and_themes),
      strengths: asStringList(card.strengths),
      weaknesses: asStringList(card.weaknesses),
    }
  })

  const calendarRows = calendar.map((raw, index) => {
    const row = asRecord(raw) ?? {}
    return {
      day: typeof row.day === 'number' ? row.day : index + 1,
      date: asString(row.date),
      contentType: asString(row.content_type) || 'Post',
      hook: asString(row.hook),
      caption: asString(row.caption),
      hashtags: asStringList(row.hashtags),
      cta: asString(row.cta),
      reasoning: asString(row.reasoning),
    }
  })

  return (
    <div className="space-y-4">
      {analysis ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {analysis}
        </p>
      ) : null}
      {comparisonSummary ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {comparisonSummary}
        </p>
      ) : null}
      {competitorCards.length > 0 ? (
        <Section title={t('agents.output.competitorInsights')}>
          <div className="space-y-3">
            {competitorCards.map((card, index) => (
              <article
                key={`${card.handle}-${index}`}
                className="rounded-xl border border-border-hairline bg-canvas-raised px-3 py-3"
              >
                <p className="text-xs uppercase tracking-wide text-ink-muted">{card.platform}</p>
                <h5 className="mt-1 font-medium text-ink">{card.handle}</h5>
                <div className="mt-2 space-y-2">
                  {card.keySignals.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium text-ink-muted">
                        {t('agents.output.keySignals')}
                      </p>
                      <BulletList items={card.keySignals} />
                    </div>
                  ) : null}
                  {card.hooksThemes.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium text-ink-muted">
                        {t('agents.output.hooksThemes')}
                      </p>
                      <BulletList items={card.hooksThemes} />
                    </div>
                  ) : null}
                  {card.strengths.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium text-ink-muted">
                        {t('agents.output.strengths')}
                      </p>
                      <BulletList items={card.strengths} />
                    </div>
                  ) : null}
                  {card.weaknesses.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium text-ink-muted">
                        {t('agents.output.weaknesses')}
                      </p>
                      <BulletList items={card.weaknesses} />
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </Section>
      ) : null}
      {calendarRows.length > 0 ? (
        <Section title={t('agents.output.contentCalendar')}>
          <div className="space-y-3">
            {calendarRows.map((row, index) => (
              <article
                key={`day-${row.day}-${index}`}
                className="rounded-xl border border-border-hairline bg-canvas-raised px-3 py-3"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                  <span>{t('agents.output.day', { n: row.day })}</span>
                  {row.date ? <span>· {row.date}</span> : null}
                  <span className="rounded-md bg-accent-primary-soft px-2 py-0.5 font-medium text-accent-primary-deep">
                    {row.contentType}
                  </span>
                </div>
                {row.hook ? <p className="mt-2 font-medium text-ink">{row.hook}</p> : null}
                {row.caption ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">{row.caption}</p>
                ) : null}
                {row.hashtags.length > 0 ? (
                  <p className="mt-2 text-xs text-accent-primary-deep">
                    {row.hashtags
                      .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
                      .join(' ')}
                  </p>
                ) : null}
                {row.cta ? (
                  <p className="mt-2 text-sm text-ink">
                    {t('agents.output.cta', { value: row.cta })}
                  </p>
                ) : null}
                {row.reasoning ? (
                  <p className="mt-2 border-t border-border-hairline pt-2 text-xs text-ink-muted">
                    {t('agents.output.reasoning')}: {row.reasoning}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </Section>
      ) : null}
      {topHooks.length > 0 ? (
        <Section title={t('agents.output.topHooks')}>
          <BulletList items={topHooks} />
        </Section>
      ) : null}
      {captionFormulas.length > 0 ? (
        <Section title={t('agents.output.captionFormulas')}>
          <BulletList items={captionFormulas} />
        </Section>
      ) : null}
      {postingFrequency ? (
        <Section title={t('agents.output.postingCadence')}>
          <p className="text-sm text-ink">{postingFrequency}</p>
        </Section>
      ) : null}
      {differentiation.length > 0 ? (
        <Section title={t('agents.output.howToDifferentiate')}>
          <BulletList items={differentiation} />
        </Section>
      ) : null}
    </div>
  )
}

function InstagramOutputView({ output }: { output: UnknownRecord }) {
  const calendar = Array.isArray(output.content_calendar) ? output.content_calendar : []
  const competitors = Array.isArray(output.competitor_comparison)
    ? output.competitor_comparison
    : []

  if (calendar.length === 0 && competitors.length === 0) {
    return <InstagramSectionsView output={output} />
  }

  return <InstagramRichOutputView output={output} />
}

function LinkedInOutputView({ output }: { output: UnknownRecord }) {
  const { t } = useTranslation()
  const ideas = Array.isArray(output.post_ideas) ? output.post_ideas : []
  const themes = asStringList(output.thought_leadership_themes)
  const hooks = asStringList(output.hook_formulas)
  const frequency = asString(output.posting_frequency)

  const ideaCards = ideas.map((raw, index) => {
    const idea = asRecord(raw) ?? {}
    return {
      contentType: asString(idea.content_type) || 'Post',
      topic: asString(idea.topic) || t('agents.output.ideaN', { n: index + 1 }),
      hook: asString(idea.hook),
      postStructure: asString(idea.post_structure),
      cta: asString(idea.cta),
      reasoning: asString(idea.reasoning),
    }
  })

  return (
    <div className="space-y-4">
      {ideaCards.length > 0 ? (
        <Section title={t('agents.output.postIdeas')}>
          <div className="space-y-3">
            {ideaCards.map((idea, index) => (
              <article
                key={`li-${index}`}
                className="rounded-xl border border-border-hairline bg-canvas-raised px-3 py-3"
              >
                <p className="text-xs uppercase tracking-wide text-accent-primary-deep">
                  {idea.contentType}
                </p>
                <h5 className="mt-1 font-medium text-ink">{idea.topic}</h5>
                {idea.hook ? <p className="mt-2 font-medium text-ink">{idea.hook}</p> : null}
                {idea.postStructure ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
                    {idea.postStructure}
                  </p>
                ) : null}
                {idea.cta ? (
                  <p className="mt-2 text-sm text-ink">
                    {t('agents.output.cta', { value: idea.cta })}
                  </p>
                ) : null}
                {idea.reasoning ? (
                  <p className="mt-2 border-t border-border-hairline pt-2 text-xs text-ink-muted">
                    {t('agents.output.reasoning')}: {idea.reasoning}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </Section>
      ) : null}
      {themes.length > 0 ? (
        <Section title={t('agents.output.themes')}>
          <BulletList items={themes} />
        </Section>
      ) : null}
      {hooks.length > 0 ? (
        <Section title={t('agents.output.hookFormulas')}>
          <BulletList items={hooks} />
        </Section>
      ) : null}
      {frequency ? (
        <Section title={t('agents.output.postingCadence')}>
          <p className="text-sm text-ink">{frequency}</p>
        </Section>
      ) : null}
    </div>
  )
}

function PlaybookOutputView({ output }: { output: UnknownRecord }) {
  const { t } = useTranslation()
  const frameworks = asStringList(output.strategy_frameworks)
  const guardrails = asStringList(output.guardrails)
  const recommendations = asStringList(output.recommendations)
  const brokenRules = asStringList(output.broken_rules)
  const reasoning = asString(output.reasoning)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-ink-muted">
          {t('agents.output.audit')}
        </span>
        <span className="rounded-md bg-accent-primary-soft px-2 py-0.5 text-xs font-semibold text-accent-primary-deep">
          {asString(output.audit_result) || 'N/A'}
        </span>
      </div>
      {frameworks.length > 0 ? (
        <Section title={t('agents.output.strategyFrameworks')}>
          <BulletList items={frameworks} />
        </Section>
      ) : null}
      {guardrails.length > 0 ? (
        <Section title={t('agents.output.guardrails')}>
          <BulletList items={guardrails} />
        </Section>
      ) : null}
      {recommendations.length > 0 ? (
        <Section title={t('agents.output.recommendations')}>
          <BulletList items={recommendations} />
        </Section>
      ) : null}
      {brokenRules.length > 0 ? (
        <Section title={t('agents.output.brokenRules')}>
          <BulletList items={brokenRules} />
        </Section>
      ) : null}
      {reasoning ? (
        <p className="whitespace-pre-wrap border-t border-border-hairline pt-3 text-sm text-ink-muted">
          {reasoning}
        </p>
      ) : null}
    </div>
  )
}

function TwitterOutputView({ output }: { output: UnknownRecord }) {
  const { t } = useTranslation()
  const tweets = Array.isArray(output.tweet_ideas) ? output.tweet_ideas : []
  const formulas = asStringList(output.hook_formulas)
  const tactics = asStringList(output.engagement_tactics)
  const frequency = asString(output.posting_frequency)

  const tweetCards = tweets.map((raw) => {
    const tweet = asRecord(raw) ?? {}
    return {
      type: asString(tweet.type) || 'Tweet',
      hook: asString(tweet.hook),
      fullTweet: asString(tweet.full_tweet),
      reasoning: asString(tweet.reasoning),
    }
  })

  return (
    <div className="space-y-4">
      {tweetCards.length > 0 ? (
        <Section title={t('agents.output.tweetIdeas')}>
          <div className="space-y-3">
            {tweetCards.map((tweet, index) => (
              <article
                key={`tw-${index}`}
                className="rounded-xl border border-border-hairline bg-canvas-raised px-3 py-3"
              >
                <p className="text-xs uppercase tracking-wide text-accent-primary-deep">{tweet.type}</p>
                {tweet.hook ? <p className="mt-2 font-medium text-ink">{tweet.hook}</p> : null}
                {tweet.fullTweet ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
                    {tweet.fullTweet}
                  </p>
                ) : null}
                {tweet.reasoning ? (
                  <p className="mt-2 border-t border-border-hairline pt-2 text-xs text-ink-muted">
                    {t('agents.output.reasoning')}: {tweet.reasoning}
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </Section>
      ) : null}
      {formulas.length > 0 ? (
        <Section title={t('agents.output.hookFormulas')}>
          <BulletList items={formulas} />
        </Section>
      ) : null}
      {tactics.length > 0 ? (
        <Section title={t('agents.output.engagementTactics')}>
          <BulletList items={tactics} />
        </Section>
      ) : null}
      {frequency ? (
        <Section title={t('agents.output.postingCadence')}>
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
  const { t } = useTranslation()

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

  return <p className="text-sm text-ink-muted">{t('agents.output.noResponseYet')}</p>
}
