"""Deterministic guard: quoted speech in drafts/memory must come from the user's own words."""

from __future__ import annotations

import re
from typing import Any

QUOTE_PATTERN = re.compile(r'["“]([^"”]{12,})["”]')
PLACEHOLDER = "**what a customer actually said**"
DRAFT_FIELDS = {
    "post_ideas": ("post_structure", "hook"),
    "tweet_ideas": ("full_tweet", "hook"),
    "content_calendar": ("copy_paste_post", "caption", "hook"),
}


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", text.lower())).strip()


def build_allowed_text(
    user_input: str,
    chat_history: list[dict[str, str]] | None,
    memory: list[dict[str, Any]] | None,
) -> str:
    parts = [user_input or ""]
    for turn in chat_history or []:
        if turn.get("role") == "user":
            parts.append(str(turn.get("content") or ""))
    for item in memory or []:
        if item.get("source") == "user":
            parts.append(str(item.get("content") or ""))
    return _norm(" ".join(parts))


def has_unsupported_quote(text: str, allowed_norm: str) -> bool:
    return any(_norm(m) not in allowed_norm for m in QUOTE_PATTERN.findall(text or ""))


def _strip(text: str, allowed_norm: str) -> tuple[str, int]:
    removed = 0

    def repl(match: re.Match[str]) -> str:
        nonlocal removed
        if _norm(match.group(1)) in allowed_norm:
            return match.group(0)
        removed += 1
        return PLACEHOLDER

    return QUOTE_PATTERN.sub(repl, text or ""), removed


def strip_unsupported_quotes(output: dict[str, Any], allowed_norm: str) -> int:
    """Replace quotes the user never gave with a bold suggestion; returns how many were replaced."""
    total = 0
    for key, fields in DRAFT_FIELDS.items():
        for item in output.get(key) or []:
            if not isinstance(item, dict):
                continue
            for field in fields:
                if isinstance(item.get(field), str):
                    item[field], n = _strip(item[field], allowed_norm)
                    total += n
    for thread in output.get("thread_structures") or []:
        if isinstance(thread, dict) and isinstance(thread.get("tweets"), list):
            fixed = []
            for tweet in thread["tweets"]:
                text, n = _strip(str(tweet), allowed_norm)
                total += n
                fixed.append(text)
            thread["tweets"] = fixed
    if total:
        note = (
            " I replaced a customer quote I could not source from your messages with a "
            "bold suggestion; put in their real words if you have them."
        )
        output["reply"] = (str(output.get("reply") or "").rstrip() + note).strip()
    return total


def filter_memory_updates(updates: Any, allowed_norm: str) -> list[dict[str, Any]]:
    """Drop memory items that contain quoted speech the user never said."""
    if not isinstance(updates, list):
        return []
    return [
        u
        for u in updates
        if isinstance(u, dict) and not has_unsupported_quote(str(u.get("content") or ""), allowed_norm)
    ]
