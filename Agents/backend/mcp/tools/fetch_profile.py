"""Tool: fetch_profile — load Avatar profiling_data from avatars table."""

from __future__ import annotations

import logging
from typing import Any

from context.profiling_data import profile_from_avatar_row

logger = logging.getLogger(__name__)


def _from_avatar_profiling(avatar: dict[str, Any], user_id: str) -> dict[str, Any]:
    return profile_from_avatar_row(avatar, user_id)


def fetch_profile(user_id: str, avatar_id: str | None = None) -> dict[str, Any]:
    """Load profile context from avatars.profiling_data."""
    from db import supabase_client as db

    if not user_id:
        raise ValueError("user_id is required for fetch_profile")

    if avatar_id:
        db.assert_avatar_owned(avatar_id, user_id)
        avatar = db.fetch_avatar_row(avatar_id=avatar_id, user_id=None)
        if avatar and str(avatar.get("user_id") or "") == str(user_id):
            logger.info(
                "fetch_profile using profiling_data user_id=%s avatar_id=%s",
                user_id,
                avatar_id,
            )
            result = _from_avatar_profiling(avatar, user_id)
            if not (avatar.get("profiling_data") or {}):
                result["note"] = "No profiling_data yet — using avatar name/type only"
            return result

    avatar = db.fetch_avatar_row(avatar_id=avatar_id, user_id=user_id)
    if avatar and str(avatar.get("user_id") or "") == str(user_id):
        return _from_avatar_profiling(avatar, user_id)

    return {
        "source": "empty",
        "user_id": str(user_id),
        "avatar_id": avatar_id,
        "business_name": None,
        "brand_voice": None,
        "target_audience": None,
        "goals": None,
        "industry": None,
        "profiling_data": {},
        "profile_summary": None,
        "profile_summary_status": "pending",
        "website_summary": None,
        "website_summary_status": "pending",
        "website_summary_url": None,
        "note": "No avatar profile found for this user",
    }
