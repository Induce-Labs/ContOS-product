"""Tool: similarity_search — embed query + pgvector RAG (playbooks / LinkedIn / Instagram)."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

SUPPORTED_TABLES = {
    "playbooks",
    "marketing_knowledge_chunks",
    "linkedin_content_summaries",
    "instagram_content_summaries",
}

def _lexical_rank(
    query_text: str, items: list[dict[str, Any]], haystack_fn, top_k: int
) -> list[dict[str, Any]]:
    query_lower = (query_text or "").lower()
    tokens = [t for t in query_lower.split() if t]
    results: list[dict[str, Any]] = []
    for item in items:
        hay = haystack_fn(item).lower()
        score = sum(1 for token in tokens if token in hay) if tokens else 0
        results.append(
            {
                "content": item,
                "similarity": min(1.0, 0.3 + score * 0.1),
                "source": "db_lexical",
            }
        )
    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results[:top_k]


def _summary_haystack(s: dict[str, Any]) -> str:
    return " ".join(
        [
            " ".join(str(x) for x in (s.get("strategic_signals") or [])),
            " ".join(str(x) for x in (s.get("recurring_hooks_patterns") or [])),
            " ".join(str(x) for x in (s.get("content_strategies_themes") or [])),
            str(s.get("competitor_handle") or ""),
            str(s.get("platform") or ""),
        ]
    )


def _lexical_search(
    query_text: str,
    table: str,
    top_k: int,
    avatar_id: str | None = None,
    platform: str | None = None,
) -> list[dict[str, Any]]:
    """Lexical ranking over real Supabase rows when embeddings/RPC unavailable."""
    if table == "playbooks":
        from mcp.tools.fetch_playbooks import fetch_playbooks

        playbooks = fetch_playbooks()
        return _lexical_rank(
            query_text,
            playbooks,
            lambda p: " ".join(
                [
                    str(p.get("category") or ""),
                    str(p.get("topic") or ""),
                    str(p.get("rule_summary") or ""),
                    " ".join(p.get("tags") or []),
                ]
            ),
            top_k,
        )

    if table in {"linkedin_content_summaries", "instagram_content_summaries"}:
        from mcp.tools.fetch_summaries import fetch_summaries

        if not avatar_id:
            logger.warning(
                "lexical %s search without avatar_id; returning empty", table
            )
            return []
        if table == "linkedin_content_summaries":
            platform = "linkedin"
        summaries = fetch_summaries(avatar_id=avatar_id, platform=platform)
        if table == "linkedin_content_summaries":
            summaries = [
                s
                for s in summaries
                if (s.get("platform") or "").lower() == "linkedin"
                or "linkedin" in str(s.get("source") or "").lower()
            ]
        elif platform:
            summaries = [
                s
                for s in summaries
                if (s.get("platform") or "").lower() == platform.lower()
            ]
        return _lexical_rank(query_text, summaries, _summary_haystack, top_k)

    raise ValueError(f"Unsupported table for similarity_search: {table}")


def _format_summary_hits(
    rows: list[dict[str, Any]], default_source: str
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for r in rows:
        summary = r.get("summary") if isinstance(r.get("summary"), dict) else {}
        content = {
            **summary,
            "summary_id": r.get("id"),
            "competitor_id": r.get("competitor_id"),
            "avatar_id": r.get("avatar_id"),
            "model_used": r.get("model_used"),
            "generated_at": r.get("generated_at"),
            "platform": summary.get("platform"),
            "source": summary.get("source") or default_source,
        }
        results.append(
            {
                "content": content,
                "similarity": r.get("similarity"),
                "source": "pgvector",
            }
        )
    return results


def similarity_search(
    query_text: str,
    table: str = "playbooks",
    top_k: int = 5,
    fast: bool = False,
    avatar_id: str | None = None,
    platform: str | None = None,
    user_id: str | None = None,
) -> list[dict[str, Any]]:
    """Embed query_text and run pgvector similarity search (agentic RAG retrieve).

    - linkedin_content_summaries → LinkedIn competitor RAG (requires avatar_id)
    - instagram_content_summaries → Instagram summaries (requires avatar_id)
    """
    table = (table or "playbooks").strip()
    if table not in SUPPORTED_TABLES:
        raise ValueError(
            "table must be one of: playbooks, linkedin_content_summaries, "
            "instagram_content_summaries"
        )
    if not (query_text or "").strip():
        raise ValueError("query_text is required for similarity_search")

    if table in {"linkedin_content_summaries", "instagram_content_summaries"}:
        if not avatar_id:
            raise ValueError(
                f"avatar_id is required for similarity_search on table={table}"
            )
        if user_id:
            from db import supabase_client as db

            db.assert_avatar_owned(avatar_id, user_id)

    if fast:
        logger.info(
            "similarity_search fast=True; lexical rank over DB rows table=%s", table
        )
        return _lexical_search(
            query_text, table, top_k, avatar_id=avatar_id, platform=platform
        )

    from embeddings.embed import generate_embedding
    from db import supabase_client as db

    if table == "marketing_knowledge_chunks":
        from context.query_enrichment import build_avatar_aware_query

        query_text = build_avatar_aware_query(query_text, avatar_id, user_id)

    embedding = generate_embedding(query_text)

    if table == "playbooks":
        rows = db.similarity_search_playbooks(embedding, top_k=top_k)
        if rows:
            return [
                {
                    "content": {
                        "id": r.get("id"),
                        "category": r.get("category"),
                        "topic": r.get("topic"),
                        "rule_summary": r.get("rule_summary"),
                        "examples": r.get("examples"),
                        "tags": r.get("tags"),
                    },
                    "similarity": r.get("similarity"),
                    "source": "pgvector",
                }
                for r in rows
            ]
        logger.info("match_playbooks returned 0 rows; falling back to lexical DB rank")
        return _lexical_search(
            query_text, table, top_k, avatar_id=avatar_id, platform=platform
        )

    if table == "marketing_knowledge_chunks":
        rows = db.similarity_search_marketing_knowledge(embedding, top_k=top_k)
        return [
            {
                "content": {
                    "category": "Source transcript",
                    "topic": row.get("section") or row.get("source_name"),
                    "rule_summary": row.get("content"),
                    "source_name": row.get("source_name"),
                    "chunk_index": row.get("chunk_index"),
                    "metadata": row.get("metadata") or {},
                },
                "similarity": row.get("similarity"),
                "source": "pgvector",
            }
            for row in rows
        ]

    if table == "linkedin_content_summaries":
        rows = db.similarity_search_linkedin_summaries(
            embedding, top_k=top_k, avatar_id=avatar_id
        )
        if rows:
            return _format_summary_hits(
                rows, "supabase.linkedin_content_summaries"
            )
        logger.info(
            "linkedin vector search returned 0 rows; lexical fallback avatar_id=%s",
            avatar_id,
        )
        return _lexical_search(
            query_text, table, top_k, avatar_id=avatar_id, platform="linkedin"
        )

    platform_filter = (platform or "instagram").lower().strip()
    try:
        rows = db.similarity_search_content_summaries(
            embedding,
            top_k=top_k,
            avatar_id=avatar_id,
            platform=platform_filter,
        )
    except Exception as exc:
        logger.warning(
            "instagram_content_summaries vector search unavailable (%s); lexical fallback",
            exc,
        )
        return _lexical_search(
            query_text,
            table,
            top_k,
            avatar_id=avatar_id,
            platform=platform_filter,
        )

    if rows:
        return _format_summary_hits(rows, "supabase.instagram_content_summaries")

    logger.info(
        "instagram_content_summaries vector search returned 0 rows; lexical fallback platform=%s",
        platform_filter,
    )
    return _lexical_search(
        query_text,
        table,
        top_k,
        avatar_id=avatar_id,
        platform=platform_filter,
    )
