import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useTranslatedTexts } from '../../hooks/useTranslatedTexts'
import { parseCompetitorSummary, type DashboardSummary } from '../../lib/summaries'
import type { Competitor } from '../../lib/competitors'
import { displayCompetitorHandle } from '../../lib/instagram-display'

type CompetitorSummaryCardProps = {
  competitor: Competitor
  summaryRecord: DashboardSummary
}

export function CompetitorSummaryCard({
  competitor,
  summaryRecord,
}: CompetitorSummaryCardProps) {
  const { t } = useTranslation()
  const summary = parseCompetitorSummary(summaryRecord.summary)

  const dynamicInputs = useMemo(() => {
    if (!summary) {
      return [] as string[]
    }
    const captions = summary.top_performing_content.map((item) => item.caption_excerpt || '')
    const whys = summary.top_performing_content.map((item) => item.why_it_performed || '')
    return [
      ...captions,
      ...whys,
      ...summary.recurring_hooks_patterns,
      ...summary.content_strategies_themes,
      ...summary.strategic_signals,
    ]
  }, [summary])

  const { texts: translated, isTranslating, error: translationError } =
    useTranslatedTexts(dynamicInputs)

  if (!summary) {
    return (
      <section className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6">
        <p className="text-sm text-ink-muted">{t('competitors.summaryCard.unavailable')}</p>
      </section>
    )
  }

  const metrics = summary.aggregated_engagement_metrics
  const platformKey =
    competitor.platform === 'linkedin' || summaryRecord.source === 'linkedin'
      ? 'linkedin'
      : competitor.platform === 'twitter' || summaryRecord.source === 'twitter'
        ? 'twitter'
        : 'instagram'
  const platformLabel = t(`common.platforms.${platformKey}`)
  const isScrapeAnalyzeOnly = platformKey === 'linkedin' || platformKey === 'twitter'

  const topCount = summary.top_performing_content.length
  const translatedCaptions = translated.slice(0, topCount)
  const translatedWhys = translated.slice(topCount, topCount * 2)
  let offset = topCount * 2
  const translatedHooks = translated.slice(
    offset,
    offset + summary.recurring_hooks_patterns.length,
  )
  offset += summary.recurring_hooks_patterns.length
  const translatedThemes = translated.slice(
    offset,
    offset + summary.content_strategies_themes.length,
  )
  offset += summary.content_strategies_themes.length
  const translatedSignals = translated.slice(
    offset,
    offset + summary.strategic_signals.length,
  )

  return (
    <section className="space-y-6">
      {isTranslating || translationError ? (
        <p className="text-xs text-ink-muted">
          {translationError
            ? t('agents.translationFailed')
            : t('agents.translating')}
        </p>
      ) : null}

      <header className="rounded-[2rem] border border-border-hairline bg-canvas-raised p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-signal-positive">
              {t('competitors.summaryCard.intelligenceReport', { platform: platformLabel })}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-ink">
              {displayCompetitorHandle(competitor.handle_or_url, competitor.platform)}
            </h2>
            <p className="mt-2 text-sm text-ink-muted">
              {t('competitors.summaryCard.generated', {
                datetime: new Date(summaryRecord.generated_at).toLocaleString(),
                model: summaryRecord.model_used,
              })}
            </p>
          </div>
          <span className="rounded-full bg-signal-positive-soft px-3 py-1 text-xs font-medium text-signal-positive">
            {t('pipeline.labels.done')}
          </span>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricTile
            label={t('competitors.summaryCard.metrics.totalContent')}
            value={metrics.total_content_count}
          />
          {isScrapeAnalyzeOnly ? (
            <MetricTile
              label={t('competitors.summaryCard.metrics.posts')}
              value={metrics.total_content_count}
            />
          ) : (
            <>
              <MetricTile
                label={t('competitors.summaryCard.metrics.reels')}
                value={metrics.reel_count}
              />
              <MetricTile
                label={t('competitors.summaryCard.metrics.posts')}
                value={metrics.post_count}
              />
              <MetricTile
                label={t('competitors.summaryCard.metrics.carousels')}
                value={metrics.carousel_count}
              />
            </>
          )}
          <MetricTile
            label={t('competitors.summaryCard.metrics.avgLikes')}
            value={formatMetric(metrics.avg_likes, t)}
          />
          <MetricTile
            label={t('competitors.summaryCard.metrics.avgComments')}
            value={formatMetric(metrics.avg_comments, t)}
          />
          {!isScrapeAnalyzeOnly ? (
            <MetricTile
              label={t('competitors.summaryCard.metrics.avgViews')}
              value={formatMetric(metrics.avg_views, t)}
            />
          ) : (
            <MetricTile
              label={t('competitors.summaryCard.metrics.avgShares')}
              value={formatMetric(metrics.avg_shares, t)}
            />
          )}
          <MetricTile
            label={t('competitors.summaryCard.metrics.engagementRate')}
            value={
              metrics.engagement_rate !== null
                ? `${(metrics.engagement_rate * 100).toFixed(1)}%`
                : t('competitors.summaryCard.emDash')
            }
          />
        </dl>
      </header>

      <SummarySection title={t('competitors.summaryCard.sections.topPerforming')}>
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
                <span className="rounded-full border border-border-hairline px-2 py-0.5 text-xs text-ink-muted">
                  {contentTypeLabel(item.content_type, t)}
                </span>
              </div>
              <p className="mt-3 text-sm font-medium text-ink">
                {translatedCaptions[index] ?? item.caption_excerpt}
              </p>
              <p className="mt-2 text-sm text-ink-muted">
                {translatedWhys[index] ?? item.why_it_performed}
              </p>
              <p className="mt-3 font-mono text-xs text-ink-muted">
                {t('competitors.summaryCard.likesComments', {
                  likes: formatMetric(item.likes, t),
                  comments: formatMetric(item.comments_count, t),
                })}
                {item.views !== null
                  ? t('competitors.summaryCard.viewsSuffix', {
                      views: formatMetric(item.views, t),
                    })
                  : ''}
              </p>
            </article>
          ))}
        </div>
      </SummarySection>

      <div className="grid gap-6 lg:grid-cols-2">
        <SummarySection title={t('competitors.summaryCard.sections.hooksPatterns')}>
          <BulletList items={translatedHooks} />
        </SummarySection>
        <SummarySection title={t('competitors.summaryCard.sections.strategiesThemes')}>
          <BulletList items={translatedThemes} />
        </SummarySection>
      </div>

      <SummarySection title={t('competitors.summaryCard.sections.strategicSignals')}>
        <BulletList items={translatedSignals} emphasis />
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
  const { t } = useTranslation()
  if (items.length === 0) {
    return <p className="text-sm text-ink-muted">{t('competitors.summaryCard.noItems')}</p>
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

function contentTypeLabel(
  contentType: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const normalized = contentType.trim().toLowerCase()
  const key = `competitors.summaryCard.contentTypes.${normalized}`
  const translated = t(key)
  // i18next returns the key when missing
  return translated === key ? contentType : translated
}

function formatMetric(
  value: number | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (value === null || value === undefined) {
    return t('competitors.summaryCard.emDash')
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
