"""Best-effort ContOS usage_events logging via contos_log_usage_event RPC."""

from __future__ import annotations

import logging
import threading
from typing import Any

from db.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

AGENT_OPERATION = {
    "chatbot": "agent_chatbot",
    "linkedin": "agent_linkedin",
    "instagram": "agent_instagram",
    "twitter": "agent_twitter",
    "playbook": "agent_playbook",
}


def log_usage_event(
    *,
    operation: str,
    provider: str,
    source: str = "agents",
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
    raise_on_error: bool = False,
) -> str | None:
    """Insert one usage_events row.

    Default is best-effort (never raises) for product request paths.
    Metering jobs should pass ``raise_on_error=True``.
    """
    try:
        client = get_supabase_client()
        if client is None:
            message = f"usage_events skip (no supabase) operation={operation}"
            if raise_on_error:
                raise RuntimeError(message)
            logger.info(message)
            return None
        payload = {
            "p_user_id": user_id,
            "p_avatar_id": avatar_id,
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
            "p_source": source,
            "p_source_ref": source_ref,
            "p_metadata": metadata or {},
        }
        result = client.rpc("contos_log_usage_event", payload).execute()
        event_id = result.data
        if isinstance(event_id, list) and event_id:
            event_id = event_id[0]
        if not event_id:
            message = (
                f"contos_log_usage_event returned empty id operation={operation} "
                f"source_ref={source_ref!r}"
            )
            if raise_on_error:
                raise RuntimeError(message)
            logger.error(message)
            return None
        return str(event_id)
    except Exception as exc:
        logger.error(
            "Failed to log usage_event operation=%s: %s",
            operation,
            exc,
        )
        if raise_on_error:
            raise
        return None


def log_usage_event_async(**kwargs: Any) -> None:
    """Fire-and-forget usage logging (does not block SSE / request paths)."""
    threading.Thread(
        target=log_usage_event,
        kwargs=kwargs,
        daemon=True,
    ).start()
