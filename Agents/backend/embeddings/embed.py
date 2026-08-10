"""Embedding helpers via OpenRouter (openai/text-embedding-3-small)."""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

logger = logging.getLogger(__name__)

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
# OpenRouter slug for text-embedding-3-small
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "openai/text-embedding-3-small")
EMBEDDING_DIMENSIONS = 1536


@lru_cache(maxsize=1)
def get_embedding_client() -> OpenAI:
    """OpenRouter OpenAI-compatible client for embeddings."""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set. Required for embeddings "
            f"({EMBEDDING_MODEL})."
        )
    return OpenAI(api_key=api_key, base_url=OPENROUTER_BASE)


def generate_embedding(text: str) -> list[float]:
    """Generate a 1536-dim embedding via OpenRouter text-embedding-3-small."""
    if not text or not text.strip():
        raise ValueError("Cannot embed empty text")
    client = get_embedding_client()
    response = client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=text.strip(),
        dimensions=EMBEDDING_DIMENSIONS,
    )
    embedding = list(response.data[0].embedding)
    if len(embedding) != EMBEDDING_DIMENSIONS:
        raise RuntimeError(
            f"Expected {EMBEDDING_DIMENSIONS}-dim embedding, got {len(embedding)} "
            f"(model={EMBEDDING_MODEL})"
        )
    return embedding


def playbook_to_embed_text(playbook: dict[str, Any]) -> str:
    examples = playbook.get("examples") or {}
    tags = playbook.get("tags") or []
    return "\n".join(
        [
            f"Category: {playbook.get('category', '')}",
            f"Topic: {playbook.get('topic', '')}",
            f"Rule: {playbook.get('rule_summary', '')}",
            f"Good: {examples.get('good', '')}",
            f"Bad: {examples.get('bad', '')}",
            f"Tags: {', '.join(tags)}",
        ]
    )


def store_playbooks_from_mock(mock_playbooks: list[dict[str, Any]]) -> dict[str, Any]:
    """Embed playbook seed JSON and insert into Supabase playbooks table."""
    from db.supabase_client import insert_playbook

    stored = 0
    errors: list[str] = []
    for item in mock_playbooks:
        try:
            text = playbook_to_embed_text(item)
            embedding = generate_embedding(text)
            row = {
                "category": item.get("category"),
                "topic": item.get("topic"),
                "rule_summary": item.get("rule_summary"),
                "examples": item.get("examples"),
                "tags": item.get("tags"),
                "embedding": embedding,
            }
            result = insert_playbook(row)
            if result is None:
                errors.append(f"Skipped (no supabase): {item.get('topic')}")
            else:
                stored += 1
        except Exception as exc:
            errors.append(f"{item.get('topic')}: {exc}")
            logger.error("Failed to store playbook %s: %s", item.get("topic"), exc)

    return {
        "stored": stored,
        "attempted": len(mock_playbooks),
        "errors": errors,
        "embedding_model": EMBEDDING_MODEL,
        "embedding_provider": "openrouter",
    }


def summary_to_embed_text(summary: dict[str, Any] | Any) -> str:
    """Flatten content_summaries.summary JSONB into embeddable text."""
    if not isinstance(summary, dict):
        return str(summary or "")

    parts: list[str] = []
    for key in (
        "strategic_signals",
        "recurring_hooks_patterns",
        "content_strategies_themes",
    ):
        values = summary.get(key) or []
        if isinstance(values, list):
            parts.extend(str(v) for v in values)
        elif values:
            parts.append(str(values))

    top = summary.get("top_performing_content") or []
    if isinstance(top, list):
        for item in top:
            if isinstance(item, dict):
                parts.append(
                    " ".join(
                        str(item.get(k) or "")
                        for k in ("title", "hook", "theme", "caption", "url", "type")
                    )
                )
            else:
                parts.append(str(item))

    metrics = summary.get("aggregated_engagement_metrics") or {}
    if isinstance(metrics, dict) and metrics:
        parts.append(
            "metrics "
            + " ".join(f"{k}={v}" for k, v in metrics.items() if v is not None)
        )

    text = "\n".join(p for p in parts if p and str(p).strip())
    if not text.strip():
        raise ValueError("summary JSON produced empty embed text")
    return text


def backfill_content_summary_embeddings(
    only_missing: bool = True, limit: int = 200
) -> dict[str, Any]:
    """Generate and store embeddings on content_summaries.embedding from summary JSON."""
    from db.supabase_client import (
        list_content_summaries_for_embed,
        update_content_summary_embedding,
    )

    rows = list_content_summaries_for_embed(only_missing=only_missing, limit=limit)
    updated = 0
    errors: list[str] = []
    for row in rows:
        summary_id = row.get("id")
        try:
            text = summary_to_embed_text(row.get("summary"))
            embedding = generate_embedding(text)
            result = update_content_summary_embedding(str(summary_id), embedding)
            if result is None:
                errors.append(f"{summary_id}: update returned no row")
            else:
                updated += 1
        except Exception as exc:
            errors.append(f"{summary_id}: {exc}")
            logger.error("Failed to embed content_summary %s: %s", summary_id, exc)

    return {
        "updated": updated,
        "attempted": len(rows),
        "errors": errors,
        "embedding_model": EMBEDDING_MODEL,
        "embedding_provider": "openrouter",
        "only_missing": only_missing,
    }


def backfill_linkedin_summary_embeddings(
    only_missing: bool = True, limit: int = 200
) -> dict[str, Any]:
    """Embed linkedin_content_summaries.summary into linkedin_content_summaries.embedding."""
    from db.supabase_client import (
        list_linkedin_summaries_for_embed,
        update_linkedin_summary_embedding,
    )

    rows = list_linkedin_summaries_for_embed(only_missing=only_missing, limit=limit)
    updated = 0
    errors: list[str] = []
    for row in rows:
        summary_id = row.get("id")
        try:
            text = summary_to_embed_text(row.get("summary"))
            embedding = generate_embedding(text)
            result = update_linkedin_summary_embedding(str(summary_id), embedding)
            if result is None:
                errors.append(f"{summary_id}: update returned no row")
            else:
                updated += 1
                logger.info("Embedded linkedin_content_summaries id=%s", summary_id)
        except Exception as exc:
            errors.append(f"{summary_id}: {exc}")
            logger.error(
                "Failed to embed linkedin_content_summary %s: %s", summary_id, exc
            )

    return {
        "table": "linkedin_content_summaries",
        "updated": updated,
        "attempted": len(rows),
        "errors": errors,
        "embedding_model": EMBEDDING_MODEL,
        "embedding_provider": "openrouter",
        "only_missing": only_missing,
    }
