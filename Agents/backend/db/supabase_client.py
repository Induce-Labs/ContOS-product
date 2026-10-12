"""Supabase client and query helpers for ContOS agents.

Agents must NOT call this module directly — use MCP tools only.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any
from urllib.parse import urlparse

from env_loader import load_agents_env

load_agents_env()

logger = logging.getLogger(__name__)


def _normalize_supabase_url(url: str | None) -> str | None:
    if not url:
        return None
    # Accept either project root or /rest/v1/ form from dashboards
    parsed = urlparse(url.rstrip("/"))
    if parsed.path.endswith("/rest/v1"):
        return f"{parsed.scheme}://{parsed.netloc}"
    return url.rstrip("/")


@lru_cache(maxsize=1)
def get_supabase_client():
    """Return a Supabase client or None if credentials are missing/invalid."""
    load_agents_env()
    url = _normalize_supabase_url(os.getenv("SUPABASE_URL"))
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        logger.warning("Supabase credentials missing; DB-backed MCP tools will fail")
        return None
    key_kind = (
        "secret"
        if key.startswith("sb_secret")
        else "publishable"
        if key.startswith("sb_publishable")
        else "jwt_or_other"
    )
    logger.info("Supabase client init key_kind=%s", key_kind)
    try:
        from supabase import create_client

        return create_client(url, key)
    except Exception as exc:
        logger.error("Failed to create Supabase client: %s", exc)
        return None


def _require_client():
    client = get_supabase_client()
    if client is None:
        raise RuntimeError(
            "Supabase client unavailable. Set SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY in backend/.env"
        )
    return client


def _flatten_summary_row(row: dict[str, Any], platform: str | None = None) -> dict[str, Any]:
    competitor = row.get("competitors") or {}
    if isinstance(competitor, list):
        competitor = competitor[0] if competitor else {}
    summary = row.get("summary")
    if not isinstance(summary, dict):
        summary = {"raw_summary": summary} if summary is not None else {}
    resolved_platform = platform or competitor.get("platform")
    return {
        **summary,
        "summary_id": row.get("id"),
        "competitor_id": row.get("competitor_id"),
        "avatar_id": row.get("avatar_id"),
        "competitor_handle": competitor.get("handle_or_url"),
        "platform": resolved_platform,
        "model_used": row.get("model_used"),
        "generated_at": row.get("generated_at"),
        "source": "supabase",
    }


def assert_avatar_owned(avatar_id: str, user_id: str) -> dict[str, Any]:
    """Ensure avatar exists and belongs to user_id. Returns the avatar row."""
    if not avatar_id or not str(avatar_id).strip():
        raise ValueError("avatar_id is required")
    if not user_id or not str(user_id).strip():
        raise ValueError("user_id is required")

    row = fetch_avatar_row(avatar_id=str(avatar_id).strip(), user_id=None)
    if row is None:
        raise LookupError(f"Avatar not found: {avatar_id}")
    owner = str(row.get("user_id") or "")
    if owner != str(user_id):
        raise PermissionError(
            f"Avatar {avatar_id} is not owned by user {user_id}",
        )
    return row


def fetch_avatar_row(
    avatar_id: str | None = None, user_id: str | None = None
) -> dict[str, Any] | None:
    """Load an avatar row by id, or the newest avatar for a user."""
    client = _require_client()
    try:
        if avatar_id:
            result = (
                client.table("avatars")
                .select("*")
                .eq("id", avatar_id)
                .limit(1)
                .execute()
            )
            rows = result.data or []
            return rows[0] if rows else None
        if user_id:
            result = (
                client.table("avatars")
                .select("*")
                .eq("user_id", user_id)
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
            )
            rows = result.data or []
            return rows[0] if rows else None
        return None
    except Exception as exc:
        logger.warning(
            "avatars query failed avatar_id=%s user_id=%s: %s",
            avatar_id,
            user_id,
            exc,
        )
        raise


def fetch_default_avatar_row(user_id: str) -> dict[str, Any] | None:
    """Load the user's default avatar (avatars.is_default), else newest avatar."""
    if not user_id:
        return None
    client = _require_client()
    try:
        result = (
            client.table("avatars")
            .select("*")
            .eq("user_id", user_id)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        if rows:
            return rows[0]
        return fetch_avatar_row(avatar_id=None, user_id=user_id)
    except Exception as exc:
        logger.warning("default avatar query failed user_id=%s: %s", user_id, exc)
        raise


def fetch_summaries_rows(
    avatar_id: str | None = None,
    platform: str | None = None,
) -> list[dict[str, Any]]:
    """Return summary payloads from Instagram / LinkedIn / Twitter tables for one avatar."""
    if not avatar_id:
        raise ValueError("avatar_id is required for fetch_summaries_rows")

    client = _require_client()
    try:
        query = (
            client.table("instagram_content_summaries")
            .select(
                "id, competitor_id, avatar_id, summary, model_used, generated_at, competitors(platform, handle_or_url)"
            )
            .eq("avatar_id", avatar_id)
        )
        summaries = query.execute()
        rows = summaries.data or []
        filtered: list[dict[str, Any]] = []
        for row in rows:
            competitor = row.get("competitors") or {}
            if isinstance(competitor, list):
                competitor = competitor[0] if competitor else {}
            row_platform = (competitor.get("platform") or "").lower()
            if platform and row_platform != platform.lower():
                continue
            filtered.append(_flatten_summary_row(row, platform=row_platform or platform))

        # LinkedIn intel may live in linkedin_content_summaries
        if platform is None or platform.lower() == "linkedin":
            try:
                li_query = (
                    client.table("linkedin_content_summaries")
                    .select(
                        "id, competitor_id, avatar_id, summary, model_used, generated_at, competitors(platform, handle_or_url)"
                    )
                    .eq("avatar_id", avatar_id)
                )
                li = li_query.execute()
                for row in li.data or []:
                    competitor = row.get("competitors") or {}
                    if isinstance(competitor, list):
                        competitor = competitor[0] if competitor else {}
                    flat = _flatten_summary_row(
                        row, platform=competitor.get("platform") or "linkedin"
                    )
                    flat["source"] = "supabase.linkedin_content_summaries"
                    filtered.append(flat)
            except Exception as li_exc:
                logger.info(
                    "linkedin_content_summaries skip avatar_id=%s: %s",
                    avatar_id,
                    li_exc,
                )

        # Twitter/X intel may live in twitter_content_summaries
        if platform is None or platform.lower() in {"twitter", "x"}:
            try:
                tw_query = (
                    client.table("twitter_content_summaries")
                    .select(
                        "id, competitor_id, avatar_id, summary, model_used, generated_at, competitors(platform, handle_or_url)"
                    )
                    .eq("avatar_id", avatar_id)
                )
                tw = tw_query.execute()
                for row in tw.data or []:
                    competitor = row.get("competitors") or {}
                    if isinstance(competitor, list):
                        competitor = competitor[0] if competitor else {}
                    flat = _flatten_summary_row(
                        row, platform=competitor.get("platform") or "twitter"
                    )
                    flat["source"] = "supabase.twitter_content_summaries"
                    filtered.append(flat)
            except Exception as tw_exc:
                logger.info(
                    "twitter_content_summaries skip avatar_id=%s: %s",
                    avatar_id,
                    tw_exc,
                )

        return filtered
    except Exception as exc:
        logger.warning(
            "instagram_content_summaries query failed avatar_id=%s platform=%s: %s",
            avatar_id,
            platform,
            exc,
        )
        raise


def fetch_summary_by_competitor_url(
    competitor_url: str,
    platform: str | None = None,
    avatar_id: str | None = None,
) -> dict[str, Any] | None:
    """Resolve competitor URL → instagram_content_summaries.summary from Supabase."""
    client = _require_client()
    url = (competitor_url or "").strip()
    if not url:
        return None
    try:
        query = client.table("competitors").select(
            "id, avatar_id, platform, handle_or_url, scrape_status"
        )
        if avatar_id:
            query = query.eq("avatar_id", avatar_id)
        if platform:
            query = query.eq("platform", platform.lower())
        competitors = query.execute().data or []
        match = None
        url_norm = url.rstrip("/").lower()
        for c in competitors:
            handle = (c.get("handle_or_url") or "").rstrip("/").lower()
            if handle == url_norm or url_norm in handle or handle in url_norm:
                match = c
                break
        if match is None:
            # Fallback: ilike substring search when exact scan missed
            like_query = (
                client.table("competitors")
                .select("id, avatar_id, platform, handle_or_url, scrape_status")
                .ilike("handle_or_url", f"%{url.split('/')[-1]}%")
            )
            if avatar_id:
                like_query = like_query.eq("avatar_id", avatar_id)
            like_rows = like_query.limit(5).execute().data or []
            match = like_rows[0] if like_rows else None
        if match is None:
            return None

        summary_rows = (
            client.table("instagram_content_summaries")
            .select(
                "id, competitor_id, avatar_id, summary, model_used, generated_at, competitors(platform, handle_or_url)"
            )
            .eq("competitor_id", match["id"])
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = summary_rows.data or []
        if not rows:
            # LinkedIn summaries live in a dedicated table
            match_platform = (match.get("platform") or "").lower()
            requested_platform = (platform or "").lower()
            if match_platform == "linkedin" or requested_platform == "linkedin":
                li_rows = (
                    client.table("linkedin_content_summaries")
                    .select(
                        "id, competitor_id, avatar_id, summary, model_used, generated_at, competitors(platform, handle_or_url)"
                    )
                    .eq("competitor_id", match["id"])
                    .order("generated_at", desc=True)
                    .limit(1)
                    .execute()
                )
                rows = li_rows.data or []
            elif match_platform in {"twitter", "x"} or requested_platform in {
                "twitter",
                "x",
            }:
                tw_rows = (
                    client.table("twitter_content_summaries")
                    .select(
                        "id, competitor_id, avatar_id, summary, model_used, generated_at, competitors(platform, handle_or_url)"
                    )
                    .eq("competitor_id", match["id"])
                    .order("generated_at", desc=True)
                    .limit(1)
                    .execute()
                )
                rows = tw_rows.data or []
        if not rows:
            return {
                "competitor": match,
                "summary": None,
                "note": (
                    "Competitor found but no instagram_content_summaries / "
                    "linkedin_content_summaries / twitter_content_summaries row yet"
                ),
            }
        flat = _flatten_summary_row(rows[0], platform=match.get("platform"))
        if (match.get("platform") or "").lower() == "linkedin":
            flat["source"] = "supabase.linkedin_content_summaries"
        elif (match.get("platform") or "").lower() in {"twitter", "x"}:
            flat["source"] = "supabase.twitter_content_summaries"
        return {"competitor": match, "summary": flat, "note": None}
    except Exception as exc:
        logger.warning(
            "fetch_summary_by_competitor_url failed url=%s: %s", competitor_url, exc
        )
        raise


def fetch_playbook_rows(category: str | None = None) -> list[dict[str, Any]]:
    client = _require_client()
    try:
        query = client.table("playbooks").select(
            "id, category, topic, rule_summary, examples, tags, created_at"
        )
        if category:
            query = query.eq("category", category)
        result = query.execute()
        return result.data or []
    except Exception as exc:
        logger.warning("playbooks query failed category=%s: %s", category, exc)
        raise


def similarity_search_playbooks(
    query_embedding: list[float], top_k: int = 5, category: str | None = None
) -> list[dict[str, Any]]:
    client = _require_client()
    try:
        params: dict[str, Any] = {
            "query_embedding": query_embedding,
            "match_count": top_k,
        }
        if category:
            params["filter_category"] = category
        result = client.rpc("match_playbooks", params).execute()
        return result.data or []
    except Exception as exc:
        logger.warning("match_playbooks RPC failed: %s", exc)
        raise


def similarity_search_marketing_knowledge(
    query_embedding: list[float], top_k: int = 5
) -> list[dict[str, Any]]:
    """Return source-grounded chunks from the shared marketing reference corpus."""
    client = _require_client()
    result = client.rpc(
        "match_marketing_knowledge_chunks",
        {"query_embedding": query_embedding, "match_count": top_k},
    ).execute()
    return result.data or []


def replace_marketing_knowledge_chunks(
    source_name: str, rows: list[dict[str, Any]]
) -> None:
    """Replace one document's chunks after all embeddings have succeeded."""
    if not rows:
        raise ValueError("rows is required")
    client = _require_client()
    client.table("marketing_knowledge_chunks").delete().eq(
        "source_name", source_name
    ).execute()
    client.table("marketing_knowledge_chunks").insert(rows).execute()


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / ((na ** 0.5) * (nb ** 0.5))


def _parse_embedding(raw: Any) -> list[float] | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        return [float(x) for x in raw]
    if isinstance(raw, str):
        text = raw.strip()
        if text.startswith("[") and text.endswith("]"):
            import json

            parsed = json.loads(text)
            if isinstance(parsed, list):
                return [float(x) for x in parsed]
    return None


def similarity_search_content_summaries(
    query_embedding: list[float],
    top_k: int = 5,
    avatar_id: str | None = None,
    platform: str | None = None,
) -> list[dict[str, Any]]:
    """Rank instagram_content_summaries by embedding cosine similarity (RPC or local)."""
    client = _require_client()
    platform_norm = (platform or "").lower().strip() or None

    # Prefer RPC when available (no platform filter in RPC — filter locally after)
    try:
        if not platform_norm:
            params: dict[str, Any] = {
                "query_embedding": query_embedding,
                "match_count": top_k,
            }
            if avatar_id:
                params["filter_avatar_id"] = avatar_id
            result = client.rpc("match_instagram_content_summaries", params).execute()
            if result.data:
                return result.data
    except Exception as exc:
        logger.info(
            "match_instagram_content_summaries RPC unavailable; using local cosine: %s", exc
        )

    query = client.table("instagram_content_summaries").select(
        "id, competitor_id, avatar_id, summary, model_used, generated_at, embedding, competitors(platform, handle_or_url)"
    )
    if avatar_id:
        query = query.eq("avatar_id", avatar_id)
    rows = query.limit(max(top_k * 20, 50)).execute().data or []

    scored: list[dict[str, Any]] = []
    for row in rows:
        competitor = row.get("competitors") or {}
        if isinstance(competitor, list):
            competitor = competitor[0] if competitor else {}
        row_platform = (competitor.get("platform") or "").lower()
        if platform_norm and row_platform != platform_norm:
            continue
        emb = _parse_embedding(row.get("embedding"))
        if emb is None:
            continue
        sim = _cosine_similarity(query_embedding, emb)
        summary = row.get("summary") if isinstance(row.get("summary"), dict) else {}
        enriched = {
            **summary,
            "competitor_handle": competitor.get("handle_or_url"),
            "platform": row_platform or platform_norm or competitor.get("platform"),
            "source": "supabase.instagram_content_summaries",
        }
        scored.append(
            {
                "id": row.get("id"),
                "competitor_id": row.get("competitor_id"),
                "avatar_id": row.get("avatar_id"),
                "summary": enriched,
                "model_used": row.get("model_used"),
                "generated_at": row.get("generated_at"),
                "similarity": sim,
            }
        )
    scored.sort(key=lambda r: r["similarity"], reverse=True)
    return scored[:top_k]


def list_content_summaries_for_embed(
    only_missing: bool = True, limit: int = 200
) -> list[dict[str, Any]]:
    client = _require_client()
    query = client.table("instagram_content_summaries").select(
        "id, competitor_id, avatar_id, summary, embedding"
    )
    result = query.limit(limit).execute()
    rows = result.data or []
    if only_missing:
        rows = [r for r in rows if r.get("embedding") is None]
    return rows


def update_content_summary_embedding(
    summary_id: str, embedding: list[float]
) -> dict[str, Any] | None:
    client = _require_client()
    result = (
        client.table("instagram_content_summaries")
        .update({"embedding": embedding})
        .eq("id", summary_id)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def list_linkedin_summaries_for_embed(
    only_missing: bool = True, limit: int = 200
) -> list[dict[str, Any]]:
    client = _require_client()
    result = (
        client.table("linkedin_content_summaries")
        .select("id, competitor_id, avatar_id, summary, embedding")
        .limit(limit)
        .execute()
    )
    rows = result.data or []
    if only_missing:
        rows = [r for r in rows if r.get("embedding") is None]
    return rows


def update_linkedin_summary_embedding(
    summary_id: str, embedding: list[float]
) -> dict[str, Any] | None:
    client = _require_client()
    result = (
        client.table("linkedin_content_summaries")
        .update({"embedding": embedding})
        .eq("id", summary_id)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def similarity_search_linkedin_summaries(
    query_embedding: list[float],
    top_k: int = 5,
    avatar_id: str | None = None,
) -> list[dict[str, Any]]:
    """Rank linkedin_content_summaries by embedding cosine (RPC or local)."""
    client = _require_client()

    try:
        params: dict[str, Any] = {
            "query_embedding": query_embedding,
            "match_count": top_k,
        }
        if avatar_id:
            params["filter_avatar_id"] = avatar_id
        result = client.rpc("match_linkedin_content_summaries", params).execute()
        if result.data:
            return result.data
    except Exception as exc:
        logger.info(
            "match_linkedin_content_summaries RPC unavailable; local cosine: %s",
            exc,
        )

    query = client.table("linkedin_content_summaries").select(
        "id, competitor_id, avatar_id, summary, model_used, generated_at, embedding, competitors(platform, handle_or_url)"
    )
    if avatar_id:
        query = query.eq("avatar_id", avatar_id)
    rows = query.limit(max(top_k * 20, 100)).execute().data or []

    scored: list[dict[str, Any]] = []
    for row in rows:
        emb = _parse_embedding(row.get("embedding"))
        if emb is None:
            continue
        sim = _cosine_similarity(query_embedding, emb)
        summary = row.get("summary") if isinstance(row.get("summary"), dict) else {}
        competitor = row.get("competitors") or {}
        if isinstance(competitor, list):
            competitor = competitor[0] if competitor else {}
        enriched = {
            **summary,
            "competitor_handle": competitor.get("handle_or_url"),
            "platform": competitor.get("platform") or "linkedin",
            "source": "supabase.linkedin_content_summaries",
        }
        scored.append(
            {
                "id": row.get("id"),
                "competitor_id": row.get("competitor_id"),
                "avatar_id": row.get("avatar_id"),
                "summary": enriched,
                "model_used": row.get("model_used"),
                "generated_at": row.get("generated_at"),
                "similarity": sim,
            }
        )
    scored.sort(key=lambda r: r["similarity"], reverse=True)
    return scored[:top_k]


def list_twitter_summaries_for_embed(
    only_missing: bool = True, limit: int = 200
) -> list[dict[str, Any]]:
    client = _require_client()
    result = (
        client.table("twitter_content_summaries")
        .select("id, competitor_id, avatar_id, summary, embedding")
        .limit(limit)
        .execute()
    )
    rows = result.data or []
    if only_missing:
        rows = [r for r in rows if r.get("embedding") is None]
    return rows


def update_twitter_summary_embedding(
    summary_id: str, embedding: list[float]
) -> dict[str, Any] | None:
    client = _require_client()
    result = (
        client.table("twitter_content_summaries")
        .update({"embedding": embedding})
        .eq("id", summary_id)
        .execute()
    )
    data = result.data or []
    return data[0] if data else None


def similarity_search_twitter_summaries(
    query_embedding: list[float],
    top_k: int = 5,
    avatar_id: str | None = None,
) -> list[dict[str, Any]]:
    """Rank twitter_content_summaries by embedding cosine (RPC or local)."""
    client = _require_client()

    try:
        params: dict[str, Any] = {
            "query_embedding": query_embedding,
            "match_count": top_k,
        }
        if avatar_id:
            params["filter_avatar_id"] = avatar_id
        result = client.rpc("match_twitter_content_summaries", params).execute()
        if result.data:
            return result.data
    except Exception as exc:
        logger.info(
            "match_twitter_content_summaries RPC unavailable; local cosine: %s",
            exc,
        )

    query = client.table("twitter_content_summaries").select(
        "id, competitor_id, avatar_id, summary, model_used, generated_at, embedding, competitors(platform, handle_or_url)"
    )
    if avatar_id:
        query = query.eq("avatar_id", avatar_id)
    rows = query.limit(max(top_k * 20, 100)).execute().data or []

    scored: list[dict[str, Any]] = []
    for row in rows:
        emb = _parse_embedding(row.get("embedding"))
        if emb is None:
            continue
        sim = _cosine_similarity(query_embedding, emb)
        summary = row.get("summary") if isinstance(row.get("summary"), dict) else {}
        competitor = row.get("competitors") or {}
        if isinstance(competitor, list):
            competitor = competitor[0] if competitor else {}
        enriched = {
            **summary,
            "competitor_handle": competitor.get("handle_or_url"),
            "platform": competitor.get("platform") or "twitter",
            "source": "supabase.twitter_content_summaries",
        }
        scored.append(
            {
                "id": row.get("id"),
                "competitor_id": row.get("competitor_id"),
                "avatar_id": row.get("avatar_id"),
                "summary": enriched,
                "model_used": row.get("model_used"),
                "generated_at": row.get("generated_at"),
                "similarity": sim,
            }
        )
    scored.sort(key=lambda r: r["similarity"], reverse=True)
    return scored[:top_k]


def insert_playbook(row: dict[str, Any]) -> dict[str, Any] | None:
    client = _require_client()
    result = client.table("playbooks").insert(row).execute()
    data = result.data or []
    return data[0] if data else None


def log_agent_call(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Best-effort insert into agent_calls. Never raises to callers."""
    try:
        client = get_supabase_client()
        if client is None:
            logger.info(
                "agent_calls skip (no supabase): agent_type=%s",
                payload.get("agent_type"),
            )
            return None
        result = client.table("agent_calls").insert(payload).execute()
        data = result.data or []
        return data[0] if data else None
    except Exception as exc:
        logger.error("Failed to log agent_call: %s", exc)
        return None


def update_avatar_profile_summary(
    *,
    avatar_id: str,
    status: str,
    summary: str | None = None,
    generated_at: str | None = None,
    source_hash: str | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    """Persist profile summary fields (service_role only — guarded on client updates)."""
    if not avatar_id or not str(avatar_id).strip():
        raise ValueError("avatar_id is required for update_avatar_profile_summary")
    if status not in {"pending", "generating", "completed", "failed"}:
        raise ValueError(f"Invalid profile_summary_status: {status}")

    client = _require_client()
    payload: dict[str, Any] = {
        "profile_summary_status": status,
        "profile_summary_error": error,
    }
    if summary is not None:
        payload["profile_summary"] = summary
    if generated_at is not None:
        payload["profile_summary_generated_at"] = generated_at
    if source_hash is not None:
        payload["profile_summary_source_hash"] = source_hash

    try:
        result = (
            client.table("avatars")
            .update(payload)
            .eq("id", avatar_id)
            .execute()
        )
        data = result.data or []
        if data:
            return data[0]

        row = fetch_avatar_row(avatar_id=avatar_id, user_id=None)
        if row is None:
            raise RuntimeError(
                f"Failed to update profile summary for avatar {avatar_id}: avatar not found"
            )
        return row
    except Exception as exc:
        logger.error(
            "update_avatar_profile_summary failed avatar_id=%s status=%s: %s",
            avatar_id,
            status,
            exc,
        )
        raise


_WEBSITE_SUMMARY_STATUSES = {
    "pending",
    "generating",
    "completed",
    "failed",
    "skipped",
}


def update_avatar_website_summary(
    *,
    avatar_id: str,
    status: str,
    summary: str | None = None,
    url: str | None = None,
    generated_at: str | None = None,
    source_hash: str | None = None,
    error: str | None = None,
    clear_summary: bool = False,
) -> dict[str, Any]:
    """Persist website summary fields (service_role only — guarded on client updates)."""
    if not avatar_id or not str(avatar_id).strip():
        raise ValueError("avatar_id is required for update_avatar_website_summary")
    if status not in _WEBSITE_SUMMARY_STATUSES:
        raise ValueError(f"Invalid website_summary_status: {status}")

    client = _require_client()
    payload: dict[str, Any] = {
        "website_summary_status": status,
        "website_summary_error": error,
    }
    if clear_summary:
        payload["website_summary"] = None
        payload["website_summary_url"] = None
        payload["website_summary_source_hash"] = None
        payload["website_summary_generated_at"] = None
    else:
        if summary is not None:
            payload["website_summary"] = summary
        if url is not None:
            payload["website_summary_url"] = url
        if generated_at is not None:
            payload["website_summary_generated_at"] = generated_at
        if source_hash is not None:
            payload["website_summary_source_hash"] = source_hash

    try:
        result = (
            client.table("avatars")
            .update(payload)
            .eq("id", avatar_id)
            .execute()
        )
        data = result.data or []
        if data:
            return data[0]

        row = fetch_avatar_row(avatar_id=avatar_id, user_id=None)
        if row is None:
            raise RuntimeError(
                f"Failed to update website summary for avatar {avatar_id}: avatar not found"
            )
        return row
    except Exception as exc:
        logger.error(
            "update_avatar_website_summary failed avatar_id=%s status=%s: %s",
            avatar_id,
            status,
            exc,
        )
        raise
