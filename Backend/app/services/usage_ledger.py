"""Best-effort ContOS usage_events logging via contos_log_usage_event RPC."""

from __future__ import annotations

import logging
from typing import Any

from app.clients.supabase_repo import SupabaseRepository
from app.config import Settings

logger = logging.getLogger(__name__)


def log_usage_event(
    repository: SupabaseRepository,
    *,
    operation: str,
    provider: str,
    user_id: str | None = None,
    avatar_id: str | None = None,
    model_or_actor: str | None = None,
    input_tokens: int = 0,
    output_tokens: int = 0,
    embed_tokens: int = 0,
    scrape_items: int = 0,
    sm_ops: int = 0,
    status: str = "success",
    error_message: str | None = None,
    source_ref: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> str | None:
    """Insert one usage_events row. Never raises to callers."""
    try:
        payload = {
            "p_user_id": user_id,
            "p_avatar_id": str(avatar_id) if avatar_id is not None else None,
            "p_operation": operation,
            "p_provider": provider,
            "p_model_or_actor": model_or_actor,
            "p_input_tokens": int(input_tokens or 0),
            "p_output_tokens": int(output_tokens or 0),
            "p_embed_tokens": int(embed_tokens or 0),
            "p_scrape_items": int(scrape_items or 0),
            "p_sm_ops": int(sm_ops or 0),
            "p_status": status or "success",
            "p_error_message": error_message,
            "p_source": "backend",
            "p_source_ref": source_ref,
            "p_metadata": metadata or {},
        }
        result = repository._client.rpc("contos_log_usage_event", payload).execute()
        event_id = result.data
        if isinstance(event_id, list) and event_id:
            event_id = event_id[0]
        return str(event_id) if event_id else None
    except Exception as exc:
        logger.error(
            "Failed to log usage_event operation=%s: %s",
            operation,
            exc,
            extra={"operation": operation, "avatar_id": str(avatar_id) if avatar_id else None},
        )
        return None


def log_usage_event_with_settings(
    settings: Settings,
    **kwargs: Any,
) -> str | None:
    """Convenience wrapper when only Settings is available."""
    try:
        repository = SupabaseRepository(settings)
    except Exception as exc:
        logger.error("usage_events skip (supabase init failed): %s", exc)
        return None
    return log_usage_event(repository, **kwargs)
