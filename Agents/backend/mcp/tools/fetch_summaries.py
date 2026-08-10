"""Tool: fetch_summaries — competitor intelligence for one owned project."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

VALID_PLATFORMS = {"instagram", "linkedin", "twitter"}


def fetch_summaries(
    project_id: str | None = None,
    platform: str | None = None,
    user_id: str | None = None,
) -> list[dict[str, Any]]:
    """Query content_summaries / linkedin_content_summaries for a single project."""
    from db import supabase_client as db

    if not project_id:
        raise ValueError("project_id is required for fetch_summaries")

    if user_id:
        db.assert_project_owned(project_id, user_id)

    resolved_platform: str | None = None
    if platform:
        resolved_platform = platform.lower().strip()
        if resolved_platform == "x":
            resolved_platform = "twitter"
        if resolved_platform not in VALID_PLATFORMS:
            raise ValueError(
                f"Invalid platform '{platform}'. Expected one of: {sorted(VALID_PLATFORMS)}"
            )

    rows = db.fetch_summaries_rows(project_id, resolved_platform)
    logger.info(
        "fetch_summaries project_id=%s platform=%s count=%s",
        project_id,
        resolved_platform or "all",
        len(rows),
    )
    return rows
