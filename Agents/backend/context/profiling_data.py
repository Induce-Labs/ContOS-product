"""Shared helpers for parsing avatars.profiling_data answers."""

from __future__ import annotations

import json
from typing import Any


def profiling_answer_text(value: Any) -> str | None:
    """Support legacy string answers and {question_key, question, answer} records."""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        answer = value.get("answer")
        if isinstance(answer, str):
            return answer
    return None


def flatten_profiling_data(profiling: Any) -> dict[str, str]:
    if not isinstance(profiling, dict):
        return {}
    return {
        key: text
        for key, value in profiling.items()
        if (text := profiling_answer_text(value)) is not None
    }


def format_profiling_qa_for_prompt(profiling: Any) -> list[dict[str, str]]:
    """Ordered Q&A pairs for LLM summarization prompts."""
    if not isinstance(profiling, dict):
        return []

    pairs: list[dict[str, str]] = []
    for key, value in profiling.items():
        if isinstance(value, dict):
            question = value.get("question")
            answer = profiling_answer_text(value)
            if isinstance(question, str) and answer:
                pairs.append(
                    {
                        "key": str(key),
                        "question": question.strip(),
                        "answer": answer.strip(),
                    }
                )
        elif isinstance(value, str) and value.strip():
            pairs.append(
                {
                    "key": str(key),
                    "question": str(key),
                    "answer": value.strip(),
                }
            )
    return pairs


def profiling_data_hash(profiling: Any) -> str:
    """Stable hash for idempotent summary regeneration."""
    import hashlib

    payload = json.dumps(profiling if isinstance(profiling, dict) else {}, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def profile_summary_fields(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "profile_summary": row.get("profile_summary"),
        "profile_summary_status": row.get("profile_summary_status"),
        "profile_summary_generated_at": row.get("profile_summary_generated_at"),
        "profile_summary_error": row.get("profile_summary_error"),
    }


def website_summary_fields(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "website_summary": row.get("website_summary"),
        "website_summary_status": row.get("website_summary_status"),
        "website_summary_url": row.get("website_summary_url"),
        "website_summary_generated_at": row.get("website_summary_generated_at"),
        "website_summary_error": row.get("website_summary_error"),
    }


def profile_from_avatar_row(row: dict[str, Any], user_id: str) -> dict[str, Any]:
    """Build chat/MCP profile dict from an avatars row."""
    profiling = row.get("profiling_data") or {}
    if not isinstance(profiling, dict):
        profiling = {}

    flat = flatten_profiling_data(profiling)

    return {
        "source": "avatars.profiling_data",
        "avatar_id": row.get("id"),
        "user_id": str(row.get("user_id") or user_id),
        "name": row.get("name"),
        "type": row.get("type"),
        "profiling_completeness": row.get("profiling_completeness"),
        "profiling_data": profiling,
        **profile_summary_fields(row),
        **website_summary_fields(row),
        "business_name": row.get("name"),
        "brand_voice": flat.get("brand_voice")
        or flat.get("voice")
        or flat.get("positioning"),
        "target_audience": flat.get("ideal_reader")
        or flat.get("audience")
        or flat.get("icp"),
        "goals": flat.get("content_goal") or flat.get("goals"),
        "industry": flat.get("expertise")
        or flat.get("product")
        or flat.get("biz_11")
        or row.get("type"),
        "website_url": flat.get("website_url"),
        "is_default": bool(row.get("is_default")),
    }
