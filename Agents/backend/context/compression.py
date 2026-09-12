"""Token-aware context compression."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

MAX_CONTEXT_TOKENS = int(os.getenv("AGENT_MAX_CONTEXT_TOKENS", "3500"))


def _keep_intel_per_avatar(
    intel: list[dict[str, Any]], *, per_avatar: int
) -> list[dict[str, Any]]:
    """Keep the first N competitor-intel rows for each avatar (order preserved)."""
    kept: list[dict[str, Any]] = []
    counts: dict[str, int] = {}
    for item in intel:
        if not isinstance(item, dict):
            continue
        avatar_key = str(item.get("avatar_id") or item.get("avatar_name") or "_")
        used = counts.get(avatar_key, 0)
        if used >= per_avatar:
            continue
        counts[avatar_key] = used + 1
        kept.append(item)
    return kept or intel[:per_avatar]


def estimate_tokens(text: str) -> int:
    try:
        import tiktoken

        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text))
    except Exception:
        # ~4 chars per token heuristic
        return max(1, len(text) // 4)


def compress_context(context: dict[str, Any], max_tokens: int = MAX_CONTEXT_TOKENS) -> dict[str, Any]:
    """Shrink context if serialized token count exceeds max_tokens."""
    serialized = json.dumps(context, default=str)
    tokens = estimate_tokens(serialized)
    if tokens <= max_tokens:
        return context

    logger.info("Compressing context from ~%s tokens (limit %s)", tokens, max_tokens)
    compressed = dict(context)

    # Trim competitor intelligence first. Multi-avatar must keep at least one
    # row per avatar so tagged profiles do not lose their competitor memory.
    intel = compressed.get("competitor_intelligence") or []
    if isinstance(intel, list) and len(intel) > 1:
        if compressed.get("multi_avatar"):
            compressed["competitor_intelligence"] = _keep_intel_per_avatar(
                intel, per_avatar=2
            )
        else:
            compressed["competitor_intelligence"] = intel[:1]

    playbooks = compressed.get("relevant_playbooks") or []
    if isinstance(playbooks, list) and len(playbooks) > 3:
        compressed["relevant_playbooks"] = playbooks[:3]

    serialized = json.dumps(compressed, default=str)
    if estimate_tokens(serialized) <= max_tokens:
        return compressed

    # Aggressive trim — still keep one compact row per avatar when tagged.
    if isinstance(compressed.get("competitor_intelligence"), list):
        source = compressed["competitor_intelligence"]
        if compressed.get("multi_avatar"):
            source = _keep_intel_per_avatar(source, per_avatar=1)
        else:
            source = source[:1]
        trimmed_intel = []
        for item in source:
            trimmed_intel.append(
                {
                    "avatar_id": item.get("avatar_id"),
                    "avatar_name": item.get("avatar_name"),
                    "competitor_handle": item.get("competitor_handle"),
                    "platform": item.get("platform"),
                    "strategic_signals": (item.get("strategic_signals") or [])[:3],
                    "top_hooks": (item.get("top_hooks") or [])[:3],
                    "top_content_themes": (item.get("top_content_themes") or [])[:3],
                }
            )
        compressed["competitor_intelligence"] = trimmed_intel

    if isinstance(compressed.get("relevant_playbooks"), list):
        compressed["relevant_playbooks"] = [
            {
                "topic": p.get("topic"),
                "rule_summary": p.get("rule_summary"),
                "category": p.get("category"),
            }
            for p in compressed["relevant_playbooks"][:2]
        ]

    return compressed
