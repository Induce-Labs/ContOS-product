"""Tool: scrape_competitor — resolve competitor intelligence from Supabase."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def _handle_from_url(competitor_url: str, platform: str) -> str:
    raw = (competitor_url or "").strip()
    if not raw:
        return "unknown"
    if raw.startswith("@"):
        return raw
    try:
        path = urlparse(raw if "://" in raw else f"https://{raw}").path.strip("/")
        part = path.split("/")[-1] if path else raw
        part = part.lstrip("@") or raw
        return f"@{part}" if platform != "linkedin" else part
    except Exception:
        return raw[:64]


def scrape_competitor(
    competitor_url: str,
    platform: str,
    avatar_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Load existing competitor summary from Supabase for an owned avatar only."""
    from db import supabase_client as db

    if not avatar_id:
        raise ValueError("avatar_id is required for scrape_competitor")
    if user_id:
        db.assert_avatar_owned(avatar_id, user_id)

    platform = (platform or "").lower().strip()
    if platform == "x":
        platform = "twitter"
    if platform not in {"instagram", "linkedin", "twitter", "reddit"}:
        raise ValueError(
            f"Unsupported platform '{platform}'. Expected instagram|linkedin|twitter"
        )

    handle = _handle_from_url(competitor_url, platform)
    logger.info(
        "scrape_competitor resolve url=%s platform=%s avatar_id=%s",
        competitor_url,
        platform,
        avatar_id,
    )

    found = db.fetch_summary_by_competitor_url(
        competitor_url=competitor_url,
        platform=platform if platform != "reddit" else None,
        avatar_id=avatar_id,
    )
    if not found or not found.get("summary"):
        raise LookupError(
            "No content summary found in Supabase for "
            f"url={competitor_url!r} platform={platform} avatar_id={avatar_id}. "
            "Run the scrape/summarize pipeline first for a competitor on this avatar."
        )

    summary = dict(found["summary"])
    competitor = found.get("competitor") or {}
    summary.setdefault("competitor_handle", competitor.get("handle_or_url") or handle)
    summary.setdefault("competitor_url", competitor_url)
    summary.setdefault("platform", competitor.get("platform") or platform)
    summary["source"] = "supabase"

    return {
        "source": "supabase",
        "competitor_url": competitor_url,
        "competitor_handle": summary.get("competitor_handle"),
        "platform": summary.get("platform"),
        "scrape_status": competitor.get("scrape_status") or "from_db",
        "summary": summary,
        "note": found.get("note"),
    }
