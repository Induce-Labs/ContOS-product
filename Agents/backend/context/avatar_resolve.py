"""Resolve which avatar IDs apply to an Agents invoke."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class AvatarResolutionError(Exception):
    """Raised when tagged avatars are invalid or not owned by the user."""

    def __init__(self, message: str, *, status_code: int = 403):
        super().__init__(message)
        self.status_code = status_code


def resolve_avatar_ids(
    *,
    user_id: str,
    avatar_id: str | None,
    tagged_avatar_ids: list[str] | None,
) -> list[str]:
    """
    Resolve avatar context ids (avatars.id).

    1. tagged_avatar_ids if present (all must be owned)
    2. else active avatar_id if owned
    3. else user's default avatar (is_default)
    4. else empty list
    """
    from db import supabase_client as db

    tagged = [str(x).strip() for x in (tagged_avatar_ids or []) if str(x).strip()]
    if tagged:
        resolved: list[str] = []
        for tagged_id in tagged:
            row = db.fetch_avatar_row(avatar_id=tagged_id, user_id=None)
            if not row:
                raise AvatarResolutionError(
                    f"Avatar not found: {tagged_id}",
                    status_code=404,
                )
            if str(row.get("user_id") or "") != str(user_id):
                raise AvatarResolutionError(
                    f"Avatar not owned by authenticated user: {tagged_id}",
                    status_code=403,
                )
            if tagged_id not in resolved:
                resolved.append(tagged_id)
        return resolved

    if avatar_id:
        db.assert_avatar_owned(avatar_id, user_id)
        return [str(avatar_id)]

    default_row = db.fetch_default_avatar_row(user_id)
    if default_row and default_row.get("id"):
        return [str(default_row["id"])]

    logger.info("resolve_avatar_ids: no avatar for user_id=%s", user_id)
    return []


def load_avatar_rows(avatar_ids: list[str], user_id: str) -> list[dict[str, Any]]:
    """Load owned avatar rows for resolved avatar ids."""
    from db import supabase_client as db

    rows: list[dict[str, Any]] = []
    for aid in avatar_ids:
        row = db.fetch_avatar_row(avatar_id=aid, user_id=None)
        if not row:
            continue
        if str(row.get("user_id") or "") != str(user_id):
            raise AvatarResolutionError(
                f"Avatar not owned by authenticated user: {aid}",
                status_code=403,
            )
        rows.append(row)
    return rows
