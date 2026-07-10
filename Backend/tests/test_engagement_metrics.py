from app.services.engagement_metrics import (
    compute_aggregated_engagement_metrics,
    enrich_competitor_summary,
)


class TestEngagementMetrics:
    def test_compute_counts_from_scraped_content(self) -> None:
        items = [
            {
                "external_id": "1",
                "content_type": "reel",
                "likes": 100,
                "views": None,
                "shares": 2,
                "comments_count": 10,
            },
            {
                "external_id": "2",
                "content_type": "reel",
                "likes": 200,
                "views": None,
                "shares": 0,
                "comments_count": 20,
            },
            {
                "external_id": "3",
                "content_type": "carousel",
                "likes": 50,
                "views": None,
                "shares": None,
                "comments_count": 5,
            },
            {
                "external_id": "4",
                "content_type": "post",
                "likes": -1,
                "views": None,
                "shares": None,
                "comments_count": 1,
            },
        ]

        metrics = compute_aggregated_engagement_metrics(items)

        assert metrics.total_content_count == 4
        assert metrics.reel_count == 2
        assert metrics.carousel_count == 1
        assert metrics.post_count == 1
        assert metrics.avg_likes == 116.67
        assert metrics.avg_comments == 9.0
        assert metrics.engagement_rate == 0.0771

    def test_compute_engagement_rate_from_views_when_available(self) -> None:
        items = [
            {
                "external_id": "1",
                "content_type": "reel",
                "likes": 100,
                "views": 1000,
                "shares": 0,
                "comments_count": 50,
            },
            {
                "external_id": "2",
                "content_type": "reel",
                "likes": 200,
                "views": 2000,
                "shares": 10,
                "comments_count": 100,
            },
        ]

        metrics = compute_aggregated_engagement_metrics(items)

        assert metrics.engagement_rate == 0.1525

    def test_enrich_top_performing_content_with_scraped_metrics(self) -> None:
        from app.models.summary import CompetitorSummaryPayload, TopPerformingContentItem

        summary = CompetitorSummaryPayload(
            top_performing_content=[
                TopPerformingContentItem(
                    rank=1,
                    external_id="abc",
                    content_type="reel",
                    caption_excerpt="Test",
                    why_it_performed="Strong hook",
                    likes=None,
                    comments_count=None,
                ),
            ],
            recurring_hooks_patterns=[],
            content_strategies_themes=[],
            aggregated_engagement_metrics=compute_aggregated_engagement_metrics([]),
            strategic_signals=[],
        )

        enriched = enrich_competitor_summary(
            summary,
            [
                {
                    "external_id": "abc",
                    "content_type": "reel",
                    "likes": 701,
                    "views": None,
                    "shares": 0,
                    "comments_count": 25,
                },
            ],
        )

        assert enriched.top_performing_content[0].likes == 701
        assert enriched.top_performing_content[0].comments_count == 25
        assert enriched.aggregated_engagement_metrics.total_content_count == 1
