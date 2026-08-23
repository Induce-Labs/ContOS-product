"""JWT auth and project ownership for ContOS Agents API."""

from __future__ import annotations

import logging
import os
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status

logger = logging.getLogger(__name__)


def _supabase_client():
    from db.supabase_client import get_supabase_client

    client = get_supabase_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
        )
    return client


def get_current_user_id(
    authorization: str | None = Header(default=None),
) -> UUID:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header. Expected Bearer <access_token>.",
        )

    access_token = authorization.removeprefix("Bearer ").strip()
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing access token.",
        )

    try:
        client = _supabase_client()
        user_response = client.auth.get_user(access_token)
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("Failed to validate access token", extra={"error": str(error)})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        ) from error

    if user_response.user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        )

    return UUID(user_response.user.id)


def verify_avatar_owner(avatar_id: str, user_id: UUID) -> None:
    """Raise 403 if avatar_id is missing or not owned by user_id."""
    from db.supabase_client import fetch_avatar_row

    if not avatar_id or not str(avatar_id).strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="avatar_id is required.",
        )

    try:
        row = fetch_avatar_row(avatar_id=str(avatar_id).strip(), user_id=None)
    except Exception as error:
        logger.error(
            "Avatar ownership lookup failed",
            extra={"avatar_id": avatar_id, "error": str(error)},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify avatar ownership.",
        ) from error

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Avatar not found.",
        )

    owner = str(row.get("user_id") or "")
    if owner != str(user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this avatar.",
        )


def require_admin_user(user_id: UUID) -> None:
    """Restrict embedding/admin routes to AGENTS_ADMIN_USER_IDS (comma-separated)."""
    raw = (os.getenv("AGENTS_ADMIN_USER_IDS") or "").strip()
    llm_env = (os.getenv("LLM_ENV") or "dev").strip().lower()

    if llm_env == "prod" and not raw:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin routes are disabled in production without AGENTS_ADMIN_USER_IDS.",
        )

    if not raw:
        # Dev convenience: any authenticated user may run backfills when unset.
        return

    allowed = {part.strip() for part in raw.split(",") if part.strip()}
    if str(user_id) not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required for this endpoint.",
        )


def get_authenticated_user_id(
    user_id: UUID = Depends(get_current_user_id),
) -> UUID:
    return user_id
