"""Token-aware context compression."""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

MAX_CONTEXT_TOKENS = 6000


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

    # Trim competitor intelligence first
    intel = compressed.get("competitor_intelligence") or []
    if isinstance(intel, list) and len(intel) > 1:
        compressed["competitor_intelligence"] = intel[:1]

    playbooks = compressed.get("relevant_playbooks") or []
    if isinstance(playbooks, list) and len(playbooks) > 3:
        compressed["relevant_playbooks"] = playbooks[:3]

    serialized = json.dumps(compressed, default=str)
    if estimate_tokens(serialized) <= max_tokens:
        return compressed

    # Aggressive trim
    if isinstance(compressed.get("competitor_intelligence"), list):
        trimmed_intel = []
        for item in compressed["competitor_intelligence"][:1]:
            trimmed_intel.append(
                {
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
