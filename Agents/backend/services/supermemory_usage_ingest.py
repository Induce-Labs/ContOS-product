"""Ingest Supermemory OpenRouter activity into ContOS usage_events."""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from db.supabase_client import get_supabase_client
from db.usage_ledger import log_usage_event
from services.openrouter_analytics import (
    OpenRouterActivityRow,
    OpenRouterAnalyticsError,
    fetch_activity_for_date,
    is_embedding_model,
    resolve_supermemory_api_key_hash,
)

logger = logging.getLogger(__name__)


def yesterday_utc() -> str:
    return (datetime.now(timezone.utc).date() - timedelta(days=1)).isoformat()


def _normalize_usage_date(raw: str | None) -> str:
    if not raw or not str(raw).strip():
        return yesterday_utc()
    value = str(raw).strip()
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(
            f"usage_date must be YYYY-MM-DD (UTC); got {value!r}"
        ) from exc
    return value


def _source_ref(*, usage_date: str, model: str, kind: str) -> str:
    # Keep refs stable and URL/path-safe.
    safe_model = model.replace("/", "_")
    return f"sm-or:{usage_date}:{safe_model}:{kind}"


def _usage_event_exists(source_ref: str) -> bool:
    client = get_supabase_client()
    if client is None:
        raise RuntimeError(
            "Supabase client unavailable; cannot check usage_events idempotency "
            f"for source_ref={source_ref!r}"
        )
    result = (
        client.table("usage_events")
        .select("id")
        .eq("source_ref", source_ref)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    return bool(rows)


def _aggregate_rows(
    rows: list[OpenRouterActivityRow],
) -> dict[tuple[str, str], dict[str, Any]]:
    """Aggregate by (model, kind) for one UTC day."""
    buckets: dict[tuple[str, str], dict[str, Any]] = defaultdict(
        lambda: {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "requests": 0,
            "usage_usd": 0.0,
        }
    )
    for row in rows:
        kind = "embed" if is_embedding_model(row.model) else "llm"
        key = (row.model, kind)
        bucket = buckets[key]
        bucket["prompt_tokens"] += max(int(row.prompt_tokens), 0)
        bucket["completion_tokens"] += max(int(row.completion_tokens), 0)
        bucket["requests"] += max(int(row.requests), 0)
        bucket["usage_usd"] += float(row.usage_usd or 0.0)
    return buckets


def ingest_supermemory_openrouter_usage(
    *,
    usage_date: str | None = None,
) -> dict[str, Any]:
    """Pull OpenRouter activity for SM key and write usage_events rows.

    Idempotent on ``source_ref``. Returns a summary for logs/admin triggers.
    """
    day = _normalize_usage_date(usage_date)
    key_hash, key_label = resolve_supermemory_api_key_hash()
    rows = fetch_activity_for_date(usage_date=day, api_key_hash=key_hash)
    aggregated = _aggregate_rows(rows)

    inserted: list[str] = []
    skipped: list[str] = []
    empty_models: list[str] = []

    for (model, kind), totals in sorted(aggregated.items()):
        source_ref = _source_ref(usage_date=day, model=model, kind=kind)
        prompt = int(totals["prompt_tokens"])
        completion = int(totals["completion_tokens"])
        if kind == "embed":
            embed_tokens = prompt + completion
            input_tokens = 0
            output_tokens = 0
            operation = "supermemory_embed"
            if embed_tokens <= 0 and int(totals["requests"]) <= 0:
                empty_models.append(source_ref)
                continue
        else:
            embed_tokens = 0
            input_tokens = prompt
            output_tokens = completion
            operation = "supermemory_llm"
            if input_tokens <= 0 and output_tokens <= 0 and int(totals["requests"]) <= 0:
                empty_models.append(source_ref)
                continue

        if _usage_event_exists(source_ref):
            skipped.append(source_ref)
            continue

        try:
            event_id = log_usage_event(
                operation=operation,
                provider="openrouter",
                source="agents",
                model_or_actor=model,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                embed_tokens=embed_tokens,
                status="success",
                source_ref=source_ref,
                metadata={
                    "usage_date": day,
                    "kind": kind,
                    "openrouter_api_key_hash_prefix": key_hash[:12],
                    "openrouter_key_label": key_label,
                    "requests": int(totals["requests"]),
                    "openrouter_usage_usd": float(totals["usage_usd"]),
                    "scope": "supermemory_infra",
                },
                raise_on_error=True,
            )
        except Exception as exc:
            # Concurrent beat/admin runs may race the unique sm-or source_ref index.
            message = str(exc).lower()
            if "usage_events_sm_or_source_ref_uidx" in message or (
                "duplicate" in message and source_ref in str(exc)
            ):
                skipped.append(source_ref)
                continue
            raise
        assert event_id  # raise_on_error guarantees a non-empty id
        inserted.append(source_ref)

    summary = {
        "usage_date": day,
        "api_key_hash_prefix": key_hash[:12],
        "key_label": key_label,
        "activity_rows": len(rows),
        "inserted": inserted,
        "skipped": skipped,
        "empty_models": empty_models,
    }
    logger.info(
        "supermemory openrouter usage ingest complete date=%s inserted=%s skipped=%s rows=%s",
        day,
        len(inserted),
        len(skipped),
        len(rows),
    )
    return summary


__all__ = [
    "OpenRouterAnalyticsError",
    "ingest_supermemory_openrouter_usage",
    "yesterday_utc",
]
