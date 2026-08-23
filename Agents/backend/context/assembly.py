"""Assemble agent context from MCP tool results + Avatar context."""

from __future__ import annotations

from typing import Any

from .compression import compress_context


def compress_summaries(summaries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Extract only key fields to reduce tokens."""
    compressed: list[dict[str, Any]] = []
    for s in summaries or []:
        top_posts = s.get("top_performing_content") or []
        compressed.append(
            {
                "avatar_id": s.get("avatar_id"),
                "avatar_name": s.get("avatar_name"),
                "competitor_handle": s.get("competitor_handle"),
                "platform": s.get("platform"),
                "strategic_signals": s.get("strategic_signals") or [],
                "top_hooks": s.get("recurring_hooks_patterns") or [],
                "top_content_themes": s.get("content_strategies_themes") or [],
                "top_posts": top_posts[:3],
                "engagement": s.get("aggregated_engagement_metrics") or {},
            }
        )
    return compressed


def assemble_context(
    profile: dict[str, Any] | None,
    summaries: list[dict[str, Any]] | None,
    playbooks: list[dict[str, Any]] | None,
    user_input: str,
    agent_type: str,
    *,
    avatar_bundle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    multi = bool(avatar_bundle and avatar_bundle.get("multi_avatar"))
    profiles = (avatar_bundle or {}).get("profiles") or (
        [profile] if profile else []
    )

    context: dict[str, Any] = {
        "brand_profile": profile or (profiles[0] if len(profiles) == 1 else {}),
        "avatar_profiles": profiles,
        "avatars": (avatar_bundle or {}).get("avatars") or [],
        "multi_avatar": multi,
        "platform": agent_type,
        "competitor_intelligence": compress_summaries(
            (avatar_bundle or {}).get("relevant_insights") or summaries or []
        ),
        "competitor_context_by_avatar": (avatar_bundle or {}).get("competitor_context")
        or [],
        "relevant_playbooks": playbooks or [],
        "user_input": user_input,
    }

    if multi:
        context["strategy_mode"] = "multi_avatar"
        context["multi_avatar_instructions"] = (
            "Reason about each Avatar independently. Preserve each identity. "
            "Identify overlaps, conflicts, synergies. Do not merge avatars into one brand."
        )
    else:
        context["strategy_mode"] = "single_avatar"

    return compress_context(context)
