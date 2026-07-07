import type { ReactNode } from 'react'
import { parseCompetitorSummary, type ContentSummary } from '../../lib/summaries'
import type { Competitor } from '../../lib/competitors'
import { displayCompetitorHandle } from '../../lib/instagram-display'

type CompetitorSummaryCardProps = {
  competitor: Competitor
  summaryRecord: ContentSummary
}

export function CompetitorSummaryCard({
  competitor,
  summaryRecord,
}: CompetitorSummaryCardProps) {
  const summary = parseCompetitorSummary(summaryRecord.summary)

  if (!summary) {
    return (
      <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6">
        <p className="text-sm text-ink-muted">Summary data is unavailable for this competitor.</p>
      </section>
    )
  }

  const metrics = summary.aggregated_engagement_metrics

  return (
    <section className="space-y-6">
      <header className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-signal-positive">
              Intelligence report
            </p>
            <h2 className="mt-1 text-xl font-semibold text-ink">
              {displayCompetitorHandle(competitor.handle_or_url)}
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              Generated {new Date(summaryRecord.generated_at).toLocaleString()} ·{' '}
              {summaryRecord.model_used}
            </p>
          </div>
          <span className="rounded-full bg-signal-positive-soft px-3 py-1 text-xs font-medium text-signal-positive">
            Done
          </span>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricTile label="Total content" value={metrics.total_content_count} />
          <MetricTile label="Reels" value={metrics.reel_count} />
          <MetricTile label="Posts" value={metrics.post_count} />
          <MetricTile label="Carousels" value={metrics.carousel_count} />
          <MetricTile label="Avg likes" value={formatMetric(metrics.avg_likes)} />
          <MetricTile label="Avg comments" value={formatMetric(metrics.avg_comments)} />
          <MetricTile label="Avg views" value={formatMetric(metrics.avg_views)} />
          <MetricTile
            label="Engagement rate"
            value={
              metrics.engagement_rate !== null
                ? `${(metrics.engagement_rate * 100).toFixed(1)}%`
                : '—'
            }
          />
        </dl>
      </header>

      <SummarySection title="Top performing content">
        <div className="space-y-3">
          {summary.top_performing_content.map((item, index) => (
            <article
              key={`top-${index}-${item.external_id}-${item.rank}`}
              className="rounded-2xl border border-border-hairline bg-canvas-raised p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-accent-primary-soft px-2 py-0.5 text-xs font-medium text-accent-primary-deep">
                  #{item.rank}
                </span>
                <span className="rounded-full border border-border-hairline px-2 py-0.5 text-xs capitalize text-ink-muted">
                  {item.content_type}
                </span>
              </div>
              <p className="mt-3 text-sm font-medium text-ink">{item.caption_excerpt}</p>
              <p className="mt-2 text-sm text-ink-muted">{item.why_it_performed}</p>
              <p className="mt-3 font-mono text-xs text-ink-muted">
                {formatMetric(item.likes)} likes · {formatMetric(item.comments_count)} comments
                {item.views !== null ? ` · ${formatMetric(item.views)} views` : ''}
              </p>
            </article>
          ))}
        </div>
      </SummarySection>

      <div className="grid gap-6 lg:grid-cols-2">
        <SummarySection title="Recurring hooks & patterns">
          <BulletList items={summary.recurring_hooks_patterns} />
        </SummarySection>
        <SummarySection title="Content strategies & themes">
          <BulletList items={summary.content_strategies_themes} />
        </SummarySection>
      </div>

      <SummarySection title="Strategic signals">
        <BulletList items={summary.strategic_signals} emphasis />
      </SummarySection>
    </section>
  )
}

type SummarySectionProps = {
  title: string
  children: ReactNode
}

function SummarySection({ title, children }: SummarySectionProps) {
  return (
    <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  )
}

type BulletListProps = {
  items: string[]
  emphasis?: boolean
}

function BulletList({ items, emphasis = false }: BulletListProps) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-muted">No items reported.</p>
  }

  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li
          key={`bullet-${index}`}
          className={`text-sm ${emphasis ? 'font-medium text-ink' : 'text-ink-muted'}`}
        >
          • {item}
        </li>
      ))}
    </ul>
  )
}

type MetricTileProps = {
  label: string
  value: string | number
}

function MetricTile({ label, value }: MetricTileProps) {
  return (
    <div className="rounded-2xl border border-border-hairline bg-canvas px-3 py-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 font-mono text-lg font-semibold text-ink">{value}</dd>
    </div>
  )
}

function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—'
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
