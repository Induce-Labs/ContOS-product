"""Tool: fetch_summaries — competitor intelligence for one owned avatar."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

VALID_PLATFORMS = {"instagram", "linkedin", "twitter"}


def fetch_summaries(
    avatar_id: str | None = None,
    platform: str | None = None,
    user_id: str | None = None,
) -> list[dict[str, Any]]:
    """Query instagram_content_summaries / linkedin_content_summaries / twitter_content_summaries for one avatar."""
    from db import supabase_client as db

    if not avatar_id:
        raise ValueError("avatar_id is required for fetch_summaries")

    if user_id:
        db.assert_avatar_owned(avatar_id, user_id)

    resolved_platform: str | None = None
    if platform:
        resolved_platform = platform.lower().strip()
        if resolved_platform == "x":
            resolved_platform = "twitter"
        if resolved_platform not in VALID_PLATFORMS:
            raise ValueError(
                f"Invalid platform '{platform}'. Expected one of: {sorted(VALID_PLATFORMS)}"
            )

    rows = db.fetch_summaries_rows(avatar_id, resolved_platform)
    logger.info(
        "fetch_summaries avatar_id=%s platform=%s count=%s",
        avatar_id,
        resolved_platform or "all",
        len(rows),
    )
    return rows
