"""Per-avatar persistent memory shared by the LinkedIn, Instagram and X agents."""

from __future__ import annotations

import logging
from typing import Any

from db import supabase_client as db

logger = logging.getLogger(__name__)

MEMORY_KINDS = ("positioning", "goal", "voice", "story", "thesis", "rejection", "note")
MEMORY_SOURCES = ("user", "scraped", "inferred")
MAX_ITEMS_PER_TURN = 6
MAX_LOADED_ITEMS = 40
MAX_CONTENT_CHARS = 1000


def load_avatar_memory(*, user_id: str, avatar_id: str) -> list[dict[str, Any]]:
    """Return active memory items for an owned avatar, newest first per kind."""
    try:
        db.assert_avatar_owned(avatar_id, user_id)
        result = (
            db._require_client()
            .table("avatar_memory")
            .select("id, kind, content, source, platform, created_at")
            .eq("avatar_id", str(avatar_id))
            .eq("status", "active")
            .order("created_at", desc=True)
            .limit(MAX_LOADED_ITEMS)
            .execute()
        )
        return [row for row in (result.data or []) if isinstance(row, dict)]
    except Exception as exc:
        logger.warning("avatar memory load failed: %s", exc)
        return []


def save_memory_updates(
    *,
    user_id: str,
    avatar_id: str,
    platform: str,
    updates: Any,
) -> list[dict[str, Any]]:
    """Validate and persist memory items proposed by the agent; never raises."""
    if not isinstance(updates, list) or not updates:
        return []
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for raw in updates[:MAX_ITEMS_PER_TURN]:
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("kind") or "").strip().lower()
        content = str(raw.get("content") or "").strip()[:MAX_CONTENT_CHARS]
        source = str(raw.get("source") or "inferred").strip().lower()
        if kind not in MEMORY_KINDS or not content:
            continue
        if source not in MEMORY_SOURCES:
            source = "inferred"
        key = (kind, content.lower())
        if key in seen:
            continue
        seen.add(key)
        rows.append(
            {
                "user_id": user_id,
                "avatar_id": str(avatar_id),
                "kind": kind,
                "content": content,
                "source": source,
                "platform": platform if platform in ("instagram", "linkedin", "twitter") else None,
            }
        )
    if not rows:
        return []
    try:
        db.assert_avatar_owned(avatar_id, user_id)
    except Exception as exc:
        logger.warning("avatar memory save rejected: %s", exc)
        return []
    saved: list[dict[str, Any]] = []
    for row in rows:
        try:
            res = db._require_client().table("avatar_memory").insert(row).execute()
            saved.extend(res.data or [])
        except Exception as exc:
            logger.info("avatar memory insert skipped (duplicate or error): %s", exc)
    return saved
