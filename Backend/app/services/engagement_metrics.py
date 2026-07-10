from typing import Any

from app.models.summary import (
    AggregatedEngagementMetrics,
    CompetitorSummaryPayload,
    TopPerformingContentItem,
)


def _valid_count(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, float) and value >= 0 and value.is_integer():
        return int(value)
    return None


def _average(values: list[int]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def compute_aggregated_engagement_metrics(
    content_items: list[dict[str, Any]],
) -> AggregatedEngagementMetrics:
    total = len(content_items)
    reel_count = sum(1 for item in content_items if item.get("content_type") == "reel")
    post_count = sum(1 for item in content_items if item.get("content_type") == "post")
    carousel_count = sum(
        1 for item in content_items if item.get("content_type") == "carousel"
    )

    likes_values = [
        value
        for item in content_items
        if (value := _valid_count(item.get("likes"))) is not None
    ]
    views_values = [
        value
        for item in content_items
        if (value := _valid_count(item.get("views"))) is not None and value > 0
    ]
    shares_values = [
        value
        for item in content_items
        if (value := _valid_count(item.get("shares"))) is not None
    ]
    comments_values = [
        value
        for item in content_items
        if (value := _valid_count(item.get("comments_count"))) is not None
    ]

    avg_likes = _average(likes_values)
    avg_views = _average(views_values)
    avg_shares = _average(shares_values)
    avg_comments = _average(comments_values)

    engagement_rate = _compute_engagement_rate(
        content_items=content_items,
        avg_likes=avg_likes,
        avg_comments=avg_comments,
    )

    return AggregatedEngagementMetrics(
        total_content_count=total,
        reel_count=reel_count,
        post_count=post_count,
        carousel_count=carousel_count,
        avg_likes=round(avg_likes, 2) if avg_likes is not None else None,
        avg_views=round(avg_views, 2) if avg_views is not None else None,
        avg_shares=round(avg_shares, 2) if avg_shares is not None else None,
        avg_comments=round(avg_comments, 2) if avg_comments is not None else None,
        engagement_rate=round(engagement_rate, 4) if engagement_rate is not None else None,
    )


def _compute_engagement_rate(
    *,
    content_items: list[dict[str, Any]],
    avg_likes: float | None,
    avg_comments: float | None,
) -> float | None:
    view_based_rates: list[float] = []

    for item in content_items:
        views = _valid_count(item.get("views"))
        if views is None or views <= 0:
            continue

        likes = _valid_count(item.get("likes")) or 0
        comments = _valid_count(item.get("comments_count")) or 0
        shares = _valid_count(item.get("shares")) or 0
        view_based_rates.append((likes + comments + shares) / views)

    if view_based_rates:
        return sum(view_based_rates) / len(view_based_rates)

    if avg_likes is None or avg_likes <= 0 or avg_comments is None:
        return None

    # Proxy when views are unavailable (e.g. basicData scraper): comment-to-like ratio.
    return avg_comments / avg_likes


def _content_lookup(content_items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        str(item["external_id"]): item
        for item in content_items
        if item.get("external_id") is not None
    }


def enrich_top_performing_content(
    top_items: list[TopPerformingContentItem],
    content_items: list[dict[str, Any]],
) -> list[TopPerformingContentItem]:
    by_external_id = _content_lookup(content_items)

    enriched: list[TopPerformingContentItem] = []

    for item in top_items:
        scraped = by_external_id.get(item.external_id)
        if scraped is None:
            enriched.append(item)
            continue

        enriched.append(
            item.model_copy(
                update={
                    "likes": _valid_count(scraped.get("likes")),
                    "views": _valid_count(scraped.get("views")),
                    "shares": _valid_count(scraped.get("shares")),
                    "comments_count": _valid_count(scraped.get("comments_count")),
                },
            ),
        )

    return enriched


def enrich_competitor_summary(
    summary: CompetitorSummaryPayload,
    content_items: list[dict[str, Any]],
) -> CompetitorSummaryPayload:
    return summary.model_copy(
        update={
            "aggregated_engagement_metrics": compute_aggregated_engagement_metrics(
                content_items,
            ),
            "top_performing_content": enrich_top_performing_content(
                summary.top_performing_content,
                content_items,
            ),
        },
    )
