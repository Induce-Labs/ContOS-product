"""Normalize client-supplied chat history for LLM continuity."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

ChatRole = Literal["user", "assistant"]

_MAX_TURNS = 12  # messages, not pairs
_MAX_CONTENT_LEN = 2000


class ChatHistoryTurn(BaseModel):
    role: ChatRole
    content: str = Field(..., min_length=1, max_length=_MAX_CONTENT_LEN)


def normalize_chat_history(
    raw: list[dict[str, Any]] | list[ChatHistoryTurn] | None,
) -> list[dict[str, str]]:
    """Return sanitized prior turns (user/assistant only), newest-trimmed.

    Raises ValueError on invalid roles or empty content after trim.
    """
    if not raw:
        return []

    if len(raw) > _MAX_TURNS * 2:
        raise ValueError(
            f"chat_history too long: at most {_MAX_TURNS * 2} messages allowed."
        )

    cleaned: list[dict[str, str]] = []
    for item in raw:
        if isinstance(item, ChatHistoryTurn):
            role = item.role
            content = item.content.strip()
        elif isinstance(item, dict):
            role = str(item.get("role") or "").strip().lower()
            content = str(item.get("content") or "").strip()
        else:
            raise ValueError("Each chat_history item must be an object with role and content.")

        if role not in ("user", "assistant"):
            raise ValueError(
                f"Invalid chat_history role '{role}'. Expected 'user' or 'assistant'."
            )
        if not content:
            continue
        if len(content) > _MAX_CONTENT_LEN:
            content = content[:_MAX_CONTENT_LEN]
        cleaned.append({"role": role, "content": content})

    # Keep the most recent turns only
    if len(cleaned) > _MAX_TURNS:
        cleaned = cleaned[-_MAX_TURNS:]

    return cleaned
