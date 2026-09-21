"""Persistence for generated content plans and post performance feedback."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any
from uuid import UUID

from db import supabase_client as db


class ContentPlanError(Exception):
    """Raised when content plan persistence or feedback validation fails."""


def _string(value: Any) -> str:
    return str(value or "").strip()


def _scheduled_date(value: Any) -> str | None:
    raw = _string(value)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError:
        return None


def persist_instagram_content_plan_items(
    *,
    user_id: str,
    avatar_id: str,
    output: dict[str, Any],
) -> list[dict[str, Any]]:
    """Persist generated Instagram calendar rows and return their IDs."""
    calendar = output.get("content_calendar")
    if not isinstance(calendar, list) or not calendar:
        return []

    try:
        db.assert_avatar_owned(avatar_id, user_id)
        rows: list[dict[str, Any]] = []
        for index, item in enumerate(calendar, start=1):
            if not isinstance(item, dict):
                continue
            rows.append(
                {
                    "user_id": str(user_id),
                    "avatar_id": str(avatar_id),
                    "platform": "instagram",
                    "day": int(item.get("day") or index),
                    "scheduled_date": _scheduled_date(item.get("date")),
                    "content_type": _string(item.get("content_type")),
                    "hook": _string(item.get("hook")),
                    "caption": _string(item.get("caption")),
                    "hashtags": [
                        _string(tag).lstrip("#")
                        for tag in (item.get("hashtags") or [])
                        if _string(tag)
                    ],
                    "cta": _string(item.get("cta")),
                    "audio_suggestion": _string(item.get("audio_suggestion")),
                    "transcript": _string(item.get("transcript")),
                    "video_prompt": _string(item.get("video_prompt")),
                    "strategy_reasoning": _string(
                        item.get("strategy_reasoning") or item.get("reasoning")
                    ),
                    "performance_goal": _string(item.get("performance_goal")),
                    "reasoning": _string(item.get("reasoning")),
                }
            )
        if not rows:
            return []
        result = db._require_client().table("content_plan_items").insert(rows).execute()
        return result.data or []
    except Exception as exc:
        raise ContentPlanError(f"Failed to persist Instagram content plan: {exc}") from exc


def load_recent_content_performance(
    *, user_id: str, avatar_id: str, limit: int = 10
) -> list[dict[str, Any]]:
    """Load recent measured posts for the next Instagram planning request."""
    try:
        db.assert_avatar_owned(avatar_id, user_id)
        result = (
            db._require_client()
            .table("content_plan_items")
            .select(
                "id, day, scheduled_date, content_type, hook, performance_goal, "
                "performance_metrics, performance_updated_at"
            )
            .eq("avatar_id", str(avatar_id))
            .eq("platform", "instagram")
            .order("performance_updated_at", desc=True)
            .limit(max(1, min(limit, 25)))
            .execute()
        )
        return [
            row
            for row in (result.data or [])
            if isinstance(row, dict)
            and isinstance(row.get("performance_metrics"), dict)
            and row.get("performance_metrics")
        ]
    except Exception:
        return []


def update_content_plan_performance(
    *,
    item_id: UUID,
    user_id: str,
    metrics: dict[str, Any],
    status: str | None = None,
    top_comments: list[str] | None = None,
) -> dict[str, Any]:
    """Attach measured metrics to one owned content-plan item."""
    client = db._require_client()
    try:
        result = (
            client.table("content_plan_items")
            .select("id, avatar_id, user_id")
            .eq("id", str(item_id))
            .limit(1)
            .execute()
        )
        row = (result.data or [None])[0]
        if not row:
            raise ContentPlanError("Content plan item not found")
        if str(row.get("user_id")) != str(user_id):
            raise ContentPlanError("Content plan item is not owned by this user")
        db.assert_avatar_owned(str(row["avatar_id"]), user_id)

        payload: dict[str, Any] = {
            "performance_metrics": {
                **metrics,
                **({"top_comments": top_comments} if top_comments else {}),
            },
            "performance_updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if status is not None:
            if status not in {"planned", "published", "archived"}:
                raise ContentPlanError("Invalid content plan status")
            payload["status"] = status
        updated = (
            client.table("content_plan_items")
            .update(payload)
            .eq("id", str(item_id))
            .execute()
        )
        return (updated.data or [payload])[0]
    except ContentPlanError:
        raise
    except Exception as exc:
        raise ContentPlanError(f"Failed to update content performance: {exc}") from exc
