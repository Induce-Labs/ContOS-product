export type ProjectType = 'personal_branding' | 'business' | 'business_1' | 'business_2'

export type ProjectStatus = 'onboarding' | 'scraping' | 'ready' | 'failed'

export type CompetitorPlatform = 'instagram' | 'twitter' | 'reddit' | 'linkedin'

export type ScrapeStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export type PipelineStep =
  | 'queued'
  | 'scraping'
  | 'transcribing'
  | 'analyzing'
  | 'done'
  | 'failed'

export type ContentType = 'reel' | 'post' | 'carousel' | 'video'

export type TopPerformingContentItem = {
  rank: number
  external_id: string
  content_type: string
  caption_excerpt: string
  why_it_performed: string
  likes: number | null
  views: number | null
  shares: number | null
  comments_count: number | null
}

export type AggregatedEngagementMetrics = {
  total_content_count: number
  reel_count: number
  post_count: number
  carousel_count: number
  avg_likes: number | null
  avg_views: number | null
  avg_shares: number | null
  avg_comments: number | null
  engagement_rate: number | null
}

export type CompetitorSummary = {
  top_performing_content: TopPerformingContentItem[]
  recurring_hooks_patterns: string[]
  content_strategies_themes: string[]
  aggregated_engagement_metrics: AggregatedEngagementMetrics
  strategic_signals: string[]
}
