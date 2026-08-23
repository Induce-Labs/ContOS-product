"""Trim scraped content before LLM summarization."""

from __future__ import annotations

from typing import Any


def engagement_score(item: dict[str, Any]) -> int:
    likes = item.get("likes") if isinstance(item.get("likes"), int) else 0
    comments = (
        item.get("comments_count") if isinstance(item.get("comments_count"), int) else 0
    )
    shares = item.get("shares") if isinstance(item.get("shares"), int) else 0
    views = item.get("views") if isinstance(item.get("views"), int) else 0
    return max(0, likes) + max(0, comments) + max(0, shares) + (max(0, views) // 100)


def _truncate_text(value: Any, max_chars: int) -> Any:
    if not isinstance(value, str) or len(value) <= max_chars:
        return value
    return value[:max_chars].rstrip() + "…"


def select_content_for_llm(
    content_items: list[dict[str, Any]],
    *,
    max_items: int = 10,
    caption_max_chars: int = 600,
    transcript_max_chars: int = 800,
) -> list[dict[str, Any]]:
    """Rank by engagement and shrink captions/transcripts so models respond quickly."""
    ranked = sorted(content_items, key=engagement_score, reverse=True)
    selected = ranked[: max(1, max_items)]

    prepared: list[dict[str, Any]] = []
    for item in selected:
        row = dict(item)
        row["caption"] = _truncate_text(row.get("caption"), caption_max_chars)
        row["transcript"] = _truncate_text(row.get("transcript"), transcript_max_chars)
        prepared.append(row)

    return prepared
