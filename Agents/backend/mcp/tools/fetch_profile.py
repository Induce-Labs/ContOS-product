"""Tool: fetch_profile — load brand profile for a user from Supabase."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def _normalize_profile(row: dict[str, Any], user_id: str | None = None) -> dict[str, Any]:
    return {
        "source": "supabase.profiles",
        "id": row.get("id"),
        "user_id": str(row.get("user_id") or user_id or ""),
        "business_name": row.get("business_name"),
        "brand_voice": row.get("brand_voice"),
        "target_audience": row.get("target_audience"),
        "goals": row.get("goals"),
        "industry": row.get("industry"),
    }


def fetch_profile(user_id: str, project_id: str | None = None) -> dict[str, Any]:
    """Query profiles by user_id; fall back only to an owned projects row stub."""
    from db import supabase_client as db

    if not user_id:
        raise ValueError("user_id is required for fetch_profile")

    if project_id:
        db.assert_project_owned(project_id, user_id)

    row = db.fetch_profile_row(user_id)
    if row:
        return _normalize_profile(row, user_id)

    project = db.fetch_project_row(project_id=project_id, user_id=user_id)
    if project and str(project.get("user_id") or "") == str(user_id):
        logger.info(
            "fetch_profile using owned projects row user_id=%s project_id=%s name=%s",
            user_id,
            project.get("id"),
            project.get("name"),
        )
        return {
            "source": "supabase.projects",
            "user_id": str(project.get("user_id") or user_id),
            "project_id": project.get("id"),
            "business_name": project.get("name"),
            "brand_voice": None,
            "target_audience": None,
            "goals": None,
            "industry": project.get("type"),
            "project_status": project.get("status"),
            "note": "No profiles row found — using projects.name/type only",
        }

    return {
        "source": "empty",
        "user_id": str(user_id),
        "project_id": project_id,
        "business_name": None,
        "brand_voice": None,
        "target_audience": None,
        "goals": None,
        "industry": None,
        "note": "No profile row for this user",
    }
