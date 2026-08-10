"""Assemble agent context from MCP tool results."""

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
) -> dict[str, Any]:
    context = {
        "brand_profile": profile or {},
        "platform": agent_type,
        "competitor_intelligence": compress_summaries(summaries or []),
        "relevant_playbooks": playbooks or [],
        "user_input": user_input,
    }
    return compress_context(context)
