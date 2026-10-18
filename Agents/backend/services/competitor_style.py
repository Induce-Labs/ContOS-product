"""Length and layout of the competitors' real posts, so drafts can follow the same format."""

from __future__ import annotations

import logging
from statistics import median
from typing import Any

from db import supabase_client as db

logger = logging.getLogger(__name__)

TABLES = {"linkedin": "linkedin_scraped_content", "instagram": "instagram_scraped_content"}
WORD_BOUNDS = {"linkedin": (100, 250), "instagram": (60, 150)}
MAX_POSTS = 40
SAMPLE_CHARS = 1500


def _words(text: str) -> int:
    return len(text.split())


def _engagement(post: dict[str, Any]) -> int:
    def num(key: str) -> int:
        try:
            return int(post.get(key) or 0)
        except (TypeError, ValueError):
            return 0

    return num("likes") + 2 * num("comments_count") + 3 * num("shares")


def compute_post_style(posts: list[dict[str, Any]], platform: str) -> dict[str, Any] | None:
    """Summarise length and layout from raw posts; None when there is nothing usable."""
    usable = [p for p in posts if isinstance(p.get("caption"), str) and _words(p["caption"]) >= 8]
    if not usable:
        return None
    counts = sorted(_words(p["caption"]) for p in usable)
    typical = int(median(counts))
    low, high = WORD_BOUNDS.get(platform, (60, 250))
    lines = [ln for p in usable for ln in p["caption"].splitlines() if ln.strip()]
    top = max(usable, key=_engagement)
    return {
        "posts_sampled": len(usable),
        "typical_words": typical,
        "words_range": [counts[len(counts) // 4], counts[(3 * len(counts)) // 4]],
        "target_words": max(low, min(high, typical)),
        "max_words": high,
        "avg_words_per_line": round(sum(_words(ln) for ln in lines) / max(1, len(lines)), 1),
        "uses_blank_line_spacing": sum("\n\n" in p["caption"] for p in usable) > len(usable) / 2,
        "sample_post": top["caption"].strip()[:SAMPLE_CHARS],
    }


def load_competitor_post_style(*, avatar_id: str, platform: str) -> dict[str, Any] | None:
    """Style of the avatar's own tracked competitors on one platform; never raises."""
    table = TABLES.get(platform)
    if not table or not avatar_id:
        return None
    try:
        client = db._require_client()
        competitors = (
            client.table("competitors")
            .select("id")
            .eq("avatar_id", str(avatar_id))
            .eq("platform", platform)
            .execute()
            .data
            or []
        )
        ids = [row["id"] for row in competitors if row.get("id")]
        if not ids:
            return None
        posts = (
            client.table(table)
            .select("caption, likes, comments_count, shares")
            .in_("competitor_id", ids)
            .order("scraped_at", desc=True)
            .limit(MAX_POSTS)
            .execute()
            .data
            or []
        )
        return compute_post_style(posts, platform)
    except Exception as exc:
        logger.warning("competitor style load failed: %s", exc)
        return None
