"""Supabase client and query helpers for ContOS agents.

Agents must NOT call this module directly — use MCP tools only.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from dotenv import load_dotenv

_ENV_PATH = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(_ENV_PATH, override=True)

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
    load_dotenv(_ENV_PATH, override=True)
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
        "project_id": row.get("project_id"),
        "competitor_handle": competitor.get("handle_or_url"),
        "platform": resolved_platform,
        "model_used": row.get("model_used"),
        "generated_at": row.get("generated_at"),
        "source": "supabase",
    }


def assert_project_owned(project_id: str, user_id: str) -> dict[str, Any]:
    """Ensure project exists and belongs to user_id. Returns the project row."""
    if not project_id or not str(project_id).strip():
        raise ValueError("project_id is required")
    if not user_id or not str(user_id).strip():
        raise ValueError("user_id is required")

    row = fetch_project_row(project_id=str(project_id).strip(), user_id=None)
    if row is None:
        raise LookupError(f"Project not found: {project_id}")
    owner = str(row.get("user_id") or "")
    if owner != str(user_id):
        raise PermissionError(
            f"Project {project_id} is not owned by user {user_id}",
        )
    return row


def fetch_profile_row(user_id: str) -> dict[str, Any] | None:
    client = _require_client()
    try:
        result = (
            client.table("profiles")
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as exc:
        logger.warning("profiles query failed for user_id=%s: %s", user_id, exc)
        raise


def fetch_any_profile_row() -> dict[str, Any] | None:
    """Return one profiles row for local testing when user_id has no match."""
    client = _require_client()
    try:
        result = (
            client.table("profiles")
            .select("*")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = result.data or []
        return rows[0] if rows else None
    except Exception as exc:
        logger.warning("profiles any-row query failed: %s", exc)
        raise


def fetch_project_row(
    project_id: str | None = None, user_id: str | None = None
) -> dict[str, Any] | None:
    """Load a project row by id, or the newest project for a user."""
    client = _require_client()
    try:
        if project_id:
            result = (
                client.table("projects")
                .select("*")
                .eq("id", project_id)
                .limit(1)
                .execute()
            )
            rows = result.data or []
            return rows[0] if rows else None
        if user_id:
            result = (
                client.table("projects")
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
            "projects query failed project_id=%s user_id=%s: %s",
            project_id,
            user_id,
            exc,
        )
        raise


def fetch_summaries_rows(
    project_id: str | None = None,
    platform: str | None = None,
) -> list[dict[str, Any]]:
    """Return summary payloads from content_summaries (+ LinkedIn table) for one project."""
    if not project_id:
        raise ValueError("project_id is required for fetch_summaries_rows")

    client = _require_client()
    try:
        query = (
            client.table("content_summaries")
            .select(
                "id, competitor_id, project_id, summary, model_used, generated_at, competitors(platform, handle_or_url)"
            )
            .eq("project_id", project_id)
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
                        "id, competitor_id, project_id, summary, model_used, generated_at, competitors(platform, handle_or_url)"
                    )
                    .eq("project_id", project_id)
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
                    "linkedin_content_summaries skip project_id=%s: %s",
                    project_id,
                    li_exc,
                )

        return filtered
    except Exception as exc:
        logger.warning(
            "content_summaries query failed project_id=%s platform=%s: %s",
            project_id,
            platform,
            exc,
        )
        raise


def fetch_summary_by_competitor_url(
    competitor_url: str,
    platform: str | None = None,
    project_id: str | None = None,
) -> dict[str, Any] | None:
    """Resolve competitor URL → content_summaries.summary from Supabase."""
    client = _require_client()
    url = (competitor_url or "").strip()
    if not url:
        return None
    try:
        query = client.table("competitors").select(
            "id, project_id, platform, handle_or_url, scrape_status"
        )
        if project_id:
            query = query.eq("project_id", project_id)
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
                .select("id, project_id, platform, handle_or_url, scrape_status")
                .ilike("handle_or_url", f"%{url.split('/')[-1]}%")
            )
            if project_id:
                like_query = like_query.eq("project_id", project_id)
            like_rows = like_query.limit(5).execute().data or []
            match = like_rows[0] if like_rows else None
        if match is None:
            return None

        summary_rows = (
            client.table("content_summaries")
            .select(
                "id, competitor_id, project_id, summary, model_used, generated_at, competitors(platform, handle_or_url)"
            )
            .eq("competitor_id", match["id"])
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = summary_rows.data or []
        if not rows:
            # LinkedIn summaries live in a dedicated table
            if (match.get("platform") or "").lower() == "linkedin" or (
                platform or ""
            ).lower() == "linkedin":
                li_rows = (
                    client.table("linkedin_content_summaries")
                    .select(
                        "id, competitor_id, project_id, summary, model_used, generated_at, competitors(platform, handle_or_url)"
                    )
                    .eq("competitor_id", match["id"])
                    .order("generated_at", desc=True)
                    .limit(1)
                    .execute()
                )
                rows = li_rows.data or []
        if not rows:
            return {
                "competitor": match,
                "summary": None,
                "note": "Competitor found but no content_summaries / linkedin_content_summaries row yet",
            }
        flat = _flatten_summary_row(rows[0], platform=match.get("platform"))
        if (match.get("platform") or "").lower() == "linkedin":
            flat["source"] = "supabase.linkedin_content_summaries"
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
    project_id: str | None = None,
    platform: str | None = None,
) -> list[dict[str, Any]]:
    """Rank content_summaries by embedding cosine similarity (RPC or local).

    Optional platform filter (e.g. instagram) applied via competitors join.
    """
    client = _require_client()
    platform_norm = (platform or "").lower().strip() or None

    # Prefer RPC when available (no platform filter in RPC — filter locally after)
    try:
        if not platform_norm:
            params: dict[str, Any] = {
                "query_embedding": query_embedding,
                "match_count": top_k,
            }
            if project_id:
                params["filter_project_id"] = project_id
            result = client.rpc("match_content_summaries", params).execute()
            if result.data:
                return result.data
    except Exception as exc:
        logger.info(
            "match_content_summaries RPC unavailable; using local cosine: %s", exc
        )

    query = client.table("content_summaries").select(
        "id, competitor_id, project_id, summary, model_used, generated_at, embedding, competitors(platform, handle_or_url)"
    )
    if project_id:
        query = query.eq("project_id", project_id)
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
            "source": "supabase.content_summaries",
        }
        scored.append(
            {
                "id": row.get("id"),
                "competitor_id": row.get("competitor_id"),
                "project_id": row.get("project_id"),
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
    query = client.table("content_summaries").select(
        "id, competitor_id, project_id, summary, embedding"
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
        client.table("content_summaries")
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
        .select("id, competitor_id, project_id, summary, embedding")
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
    project_id: str | None = None,
) -> list[dict[str, Any]]:
    """Rank linkedin_content_summaries by embedding cosine (RPC or local)."""
    client = _require_client()

    try:
        params: dict[str, Any] = {
            "query_embedding": query_embedding,
            "match_count": top_k,
        }
        if project_id:
            params["filter_project_id"] = project_id
        result = client.rpc("match_linkedin_content_summaries", params).execute()
        if result.data:
            return result.data
    except Exception as exc:
        logger.info(
            "match_linkedin_content_summaries RPC unavailable; local cosine: %s",
            exc,
        )

    query = client.table("linkedin_content_summaries").select(
        "id, competitor_id, project_id, summary, model_used, generated_at, embedding, competitors(platform, handle_or_url)"
    )
    if project_id:
        query = query.eq("project_id", project_id)
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
                "project_id": row.get("project_id"),
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
