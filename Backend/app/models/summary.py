from pydantic import BaseModel, Field


class TopPerformingContentItem(BaseModel):
    rank: int = Field(ge=1)
    external_id: str
    content_type: str
    caption_excerpt: str
    why_it_performed: str
    likes: int | None = None
    views: int | None = None
    shares: int | None = None
    comments_count: int | None = None


class AggregatedEngagementMetrics(BaseModel):
    total_content_count: int = Field(ge=0)
    reel_count: int = Field(ge=0)
    post_count: int = Field(ge=0)
    carousel_count: int = Field(ge=0)
    avg_likes: float | None = None
    avg_views: float | None = None
    avg_shares: float | None = None
    avg_comments: float | None = None
    engagement_rate: float | None = None


class CompetitorSummaryPayload(BaseModel):
    top_performing_content: list[TopPerformingContentItem]
    recurring_hooks_patterns: list[str]
    content_strategies_themes: list[str]
    aggregated_engagement_metrics: AggregatedEngagementMetrics
    strategic_signals: list[str]


SUMMARY_JSON_SCHEMA = CompetitorSummaryPayload.model_json_schema()
