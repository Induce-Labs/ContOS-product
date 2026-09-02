"""Build Avatar-scoped strategy context for Agents (profile + competitor RAG)."""

from __future__ import annotations

import logging
from typing import Any

from context.profiling_data import profile_from_avatar_row
from mcp.tools.fetch_profile import fetch_profile
from mcp.tools.fetch_summaries import fetch_summaries
from mcp.tools.similarity_search import similarity_search
from services.profile_summary import maybe_refresh_stale_profile_summary

logger = logging.getLogger(__name__)


def _profile_from_avatar_row(row: dict[str, Any], user_id: str) -> dict[str, Any]:
    return profile_from_avatar_row(row, user_id)


def _competitor_context_for_avatar(
    *,
    user_id: str,
    avatar_id: str,
    user_input: str,
    agent_type: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """RAG competitor intelligence for one avatar/project. Returns (summaries, tools_used)."""
    tools_used: list[str] = []
    summaries: list[dict[str, Any]] = []

    table = (
        "linkedin_content_summaries"
        if agent_type == "linkedin"
        else "instagram_content_summaries"
    )
    platform = "linkedin" if agent_type == "linkedin" else "instagram"

    try:
        if agent_type in {"linkedin", "instagram"}:
            matches = similarity_search(
                query_text=user_input,
                table=table,
                top_k=3,
                avatar_id=avatar_id,
                user_id=user_id,
                platform=platform if agent_type == "instagram" else None,
            )
            tools_used.append("similarity_search")
            for match in matches or []:
                payload = match.get("content") if isinstance(match, dict) else None
                if isinstance(payload, dict):
                    summaries.append(payload)
        else:
            # chatbot / default: search both platforms lightly
            for tbl, plat in (
                ("linkedin_content_summaries", "linkedin"),
                ("instagram_content_summaries", "instagram"),
            ):
                matches = similarity_search(
                    query_text=user_input,
                    table=tbl,
                    top_k=2,
                    avatar_id=avatar_id,
                    user_id=user_id,
                    platform=plat if tbl == "instagram_content_summaries" else None,
                )
                tools_used.append("similarity_search")
                for match in matches or []:
                    payload = match.get("content") if isinstance(match, dict) else None
                    if isinstance(payload, dict):
                        summaries.append(payload)
    except Exception as exc:
        logger.warning(
            "avatar RAG similarity_search failed avatar_id=%s: %s",
            avatar_id,
            exc,
        )

    if not summaries:
        try:
            fetched = fetch_summaries(
                avatar_id=avatar_id,
                user_id=user_id,
                platform=None if agent_type == "chatbot" else platform,
            )
            tools_used.append("fetch_summaries")
            if isinstance(fetched, list):
                summaries = [s for s in fetched if isinstance(s, dict)]
            elif isinstance(fetched, dict):
                summaries = list(fetched.get("summaries") or [])
        except Exception as exc:
            logger.warning(
                "avatar fetch_summaries failed avatar_id=%s: %s",
                avatar_id,
                exc,
            )

    return summaries, tools_used


def build_avatar_context(
    *,
    user_id: str,
    avatar_ids: list[str],
    user_input: str,
    agent_type: str,
) -> dict[str, Any]:
    """
    Central context builder for ContOS strategy generation.

    Returns:
      avatars, profiles, competitor_context, relevant_insights, tools_used, multi_avatar
    """
    from context.avatar_resolve import load_avatar_rows

    rows = load_avatar_rows(avatar_ids, user_id)
    avatars: list[dict[str, Any]] = []
    profiles: list[dict[str, Any]] = []
    competitor_context: list[dict[str, Any]] = []
    tools_used: list[str] = []

    for row in rows:
        avatar_id = str(row["id"])
        refresh = maybe_refresh_stale_profile_summary(row, user_id)
        if refresh and refresh.get("profile_summary"):
            row = {
                **row,
                "profile_summary": refresh["profile_summary"],
                "profile_summary_status": refresh.get("status", "completed"),
                "profile_summary_generated_at": refresh.get("generated_at"),
            }
            if refresh.get("website_summary_status"):
                row["website_summary_status"] = refresh["website_summary_status"]

        profile = _profile_from_avatar_row(row, user_id)

        if not profile.get("profiling_data"):
            try:
                enriched = fetch_profile(user_id=user_id, avatar_id=avatar_id)
                tools_used.append("fetch_profile")
                profile = {
                    **profile,
                    **{k: v for k, v in enriched.items() if v is not None},
                    "source": enriched.get("source") or profile["source"],
                    "profiling_data": profile.get("profiling_data") or {},
                }
            except Exception as exc:
                logger.warning("fetch_profile failed: %s", exc)

        summaries, rag_tools = _competitor_context_for_avatar(
            user_id=user_id,
            avatar_id=avatar_id,
            user_input=user_input,
            agent_type=agent_type,
        )
        tools_used.extend(rag_tools)

        avatars.append(
            {
                "id": avatar_id,
                "name": row.get("name"),
                "type": row.get("type"),
                "is_default": bool(row.get("is_default")),
            }
        )
        profiles.append(profile)
        competitor_context.append(
            {
                "avatar_id": avatar_id,
                "avatar_name": row.get("name"),
                "summaries": summaries,
            }
        )

    # Flattened insights for assemble_context compatibility
    flat_summaries: list[dict[str, Any]] = []
    for block in competitor_context:
        for summary in block.get("summaries") or []:
            item = dict(summary)
            item.setdefault("avatar_id", block.get("avatar_id"))
            item.setdefault("avatar_name", block.get("avatar_name"))
            flat_summaries.append(item)

    return {
        "avatars": avatars,
        "profiles": profiles,
        "competitor_context": competitor_context,
        "relevant_insights": flat_summaries,
        "tools_used": list(dict.fromkeys(tools_used)),
        "multi_avatar": len(avatars) > 1,
        # Primary profile for single-avatar callers
        "profile": profiles[0] if len(profiles) == 1 else None,
        "summaries": flat_summaries,
    }
