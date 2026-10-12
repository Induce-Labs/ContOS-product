"""Generate OpenRouter embeddings for competitor summary rows (pgvector)."""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

import httpx

from app.clients.supabase_repo import SupabaseRepository
from app.config import Settings

logger = logging.getLogger(__name__)

EMBEDDING_MODEL = "openai/text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings"


def summary_to_embed_text(summary: dict[str, Any] | Any) -> str:
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
            parts.extend(str(v) for v in values if v)

    top = summary.get("top_performing_content") or []
    if isinstance(top, list):
        for item in top:
            if not isinstance(item, dict):
                continue
            excerpt = item.get("caption_excerpt") or item.get("why_it_performed")
            if excerpt:
                parts.append(str(excerpt))

    text = "\n".join(parts).strip()
    if text:
        return text
    return json.dumps(summary, ensure_ascii=False)[:4000]


def generate_openrouter_embedding(settings: Settings, text: str) -> list[float]:
    api_key = (settings.openrouter_api_key or "").strip()
    if not api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY is required to embed competitor summaries for RAG.",
        )
    if not text.strip():
        raise ValueError("Cannot embed empty summary text.")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": EMBEDDING_MODEL,
        "input": text.strip(),
        "dimensions": EMBEDDING_DIMENSIONS,
    }

    last_error: Exception | None = None
    for attempt in range(1, 3):
        try:
            with httpx.Client(timeout=60.0) as client:
                response = client.post(
                    OPENROUTER_EMBEDDINGS_URL,
                    headers=headers,
                    json=payload,
                )
            if response.status_code >= 400:
                raise RuntimeError(
                    "OpenRouter embeddings failed with status "
                    f"{response.status_code}: {response.text}",
                )
            data = response.json()
            embedding = list(data["data"][0]["embedding"])
            if len(embedding) != EMBEDDING_DIMENSIONS:
                raise RuntimeError(
                    f"Expected {EMBEDDING_DIMENSIONS}-dim embedding, got {len(embedding)}",
                )
            return embedding
        except Exception as error:
            last_error = error
            logger.warning(
                "OpenRouter embedding attempt failed",
                extra={"attempt": attempt, "error": str(error)},
            )

    raise RuntimeError(f"OpenRouter embedding failed after retries: {last_error}") from last_error


def embed_twitter_content_summary(
    *,
    settings: Settings,
    repository: SupabaseRepository,
    competitor_id: UUID,
    summary: dict[str, Any],
) -> None:
    """Write embedding onto the latest twitter_content_summaries row for this competitor."""
    text = summary_to_embed_text(summary)
    embedding = generate_openrouter_embedding(settings, text)
    repository.update_twitter_content_summary_embedding(
        competitor_id=competitor_id,
        embedding=embedding,
    )
    logger.info(
        "Embedded twitter_content_summaries for competitor",
        extra={"competitor_id": str(competitor_id), "dims": len(embedding)},
    )
