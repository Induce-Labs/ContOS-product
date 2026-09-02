"""Generate and persist LLM profile summaries from avatars.profiling_data."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

from agents.base_agent import get_llm_client
from context.profiling_data import format_profiling_qa_for_prompt, profiling_data_hash
from services.website_summary import WebsiteSummaryError, generate_and_store_website_summary

logger = logging.getLogger(__name__)

PROFILE_SUMMARY_MODEL = os.getenv(
    "PROFILE_SUMMARY_MODEL", "google/gemini-2.5-flash"
)
PROFILE_SUMMARY_MAX_RETRIES = int(os.getenv("PROFILE_SUMMARY_MAX_RETRIES", "3"))


class ProfileSummaryError(Exception):
    """Raised when profile summary generation or persistence fails."""


def build_profile_summary_prompt(avatar: dict[str, Any]) -> str:
    profiling = avatar.get("profiling_data") or {}
    qa_pairs = format_profiling_qa_for_prompt(profiling)
    if not qa_pairs:
        raise ProfileSummaryError(
            f"Avatar {avatar.get('id')} has no profiling answers to summarize."
        )

    lines = [
        f"Avatar name: {avatar.get('name') or 'Unknown'}",
        f"Avatar type: {avatar.get('type') or 'unknown'}",
        "",
        "Profiling questionnaire answers:",
    ]
    for index, pair in enumerate(qa_pairs, start=1):
        lines.append(f"{index}. Q: {pair['question']}")
        lines.append(f"   A: {pair['answer']}")
        lines.append("")

    website_summary = avatar.get("website_summary")
    if isinstance(website_summary, str) and website_summary.strip():
        website_url = avatar.get("website_summary_url")
        lines.append("Website / brand site context (from crawled site summary):")
        if isinstance(website_url, str) and website_url.strip():
            lines.append(f"URL: {website_url.strip()}")
        lines.append(website_summary.strip())
        lines.append("")

    lines.extend(
        [
            "Write a concise, structured profile summary for a marketing chatbot.",
            "Use markdown section headings exactly as listed below.",
            "Be factual — only use information from the questionnaire answers and website "
            "context above (when present).",
            "",
            "## Background",
            "(Who they are / what they do)",
            "",
            "## Goals",
            "(Primary content and business goals)",
            "",
            "## Audience",
            "(Ideal reader, customer, or follower)",
            "",
            "## Brand Voice & Personality",
            "(Tone, style, communication preferences)",
            "",
            "## Positioning",
            "(Differentiation, offer, personal brand angle)",
            "",
            "## Competitors & Market Context",
            "(Named competitors and market signals if provided)",
            "",
            "## Key Insights & Constraints",
            "(Blockers, objections, unpopular opinions, things they avoid claiming)",
            "",
            "## Narrative Summary",
            "(2-3 short paragraphs optimized for chatbot context — dense but readable)",
        ]
    )
    return "\n".join(lines)


def _call_summary_llm(prompt: str) -> str:
    client = get_llm_client()
    last_error: Exception | None = None

    for attempt in range(1, PROFILE_SUMMARY_MAX_RETRIES + 1):
        try:
            response = client.chat.completions.create(
                model=PROFILE_SUMMARY_MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You summarize user profiling questionnaires (and optional "
                            "website context) into structured markdown for a marketing AI "
                            "assistant. Output markdown only."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=2000,
            )
            content = response.choices[0].message.content
            if not isinstance(content, str) or not content.strip():
                raise ProfileSummaryError(
                    f"Profile summary model returned empty content on attempt {attempt}."
                )
            return content.strip()
        except ProfileSummaryError:
            raise
        except Exception as exc:
            last_error = exc
            logger.warning(
                "profile_summary LLM attempt failed",
                extra={
                    "attempt": attempt,
                    "model": PROFILE_SUMMARY_MODEL,
                    "error": str(exc),
                },
            )

    raise ProfileSummaryError(
        f"Profile summary LLM failed after {PROFILE_SUMMARY_MAX_RETRIES} attempts: {last_error}"
    ) from last_error


def _run_website_summary_best_effort(
    *,
    avatar_id: str,
    row: dict[str, Any],
    force: bool,
) -> dict[str, Any]:
    try:
        return generate_and_store_website_summary(
            avatar_id=avatar_id,
            avatar_row=row,
            force=force,
        )
    except WebsiteSummaryError as exc:
        logger.warning(
            "website_summary step failed (continuing profile summary)",
            extra={"avatar_id": avatar_id, "error": str(exc)},
        )
        return {
            "avatar_id": avatar_id,
            "website_summary": None,
            "status": "failed",
            "url": None,
            "cached": False,
            "error": str(exc),
        }
    except Exception as exc:
        logger.warning(
            "website_summary step unexpected failure (continuing profile summary)",
            extra={"avatar_id": avatar_id, "error": str(exc)},
        )
        return {
            "avatar_id": avatar_id,
            "website_summary": None,
            "status": "failed",
            "url": None,
            "cached": False,
            "error": str(exc),
        }


def generate_and_store_profile_summary(
    *,
    avatar_id: str,
    user_id: str,
    force: bool = False,
) -> dict[str, Any]:
    """Generate profile summary for an owned avatar and persist on avatars row."""
    from db import supabase_client as db

    row = db.assert_avatar_owned(avatar_id, user_id)
    profiling = row.get("profiling_data") or {}
    source_hash = profiling_data_hash(profiling)

    website_result = _run_website_summary_best_effort(
        avatar_id=avatar_id,
        row=row,
        force=force,
    )
    website_status = str(website_result.get("status") or "failed")
    website_summary = website_result.get("website_summary")
    website_cached = bool(website_result.get("cached"))

    # Merge latest website fields into the in-memory row for the profile prompt.
    row = {
        **row,
        "website_summary": website_summary
        if isinstance(website_summary, str)
        else row.get("website_summary"),
        "website_summary_status": website_status,
        "website_summary_url": website_result.get("url") or row.get("website_summary_url"),
    }
    if website_status in {"skipped", "failed"} and not website_summary:
        row["website_summary"] = None

    # Fresh website context must invalidate a previously cached Q&A-only profile summary.
    website_requires_profile_refresh = (
        not website_cached and website_status == "completed" and isinstance(website_summary, str)
    )

    if not force and not website_requires_profile_refresh:
        status = row.get("profile_summary_status")
        cached_summary = row.get("profile_summary")
        cached_hash = row.get("profile_summary_source_hash")
        if (
            status == "completed"
            and isinstance(cached_summary, str)
            and cached_summary.strip()
            and cached_hash == source_hash
        ):
            return {
                "avatar_id": avatar_id,
                "profile_summary": cached_summary,
                "status": "completed",
                "generated_at": row.get("profile_summary_generated_at"),
                "cached": True,
                "website_summary_status": website_status,
            }

    db.update_avatar_profile_summary(
        avatar_id=avatar_id,
        status="generating",
        error=None,
    )

    try:
        summary = _call_summary_llm(build_profile_summary_prompt(row))
        generated_at = datetime.now(timezone.utc).isoformat()
        db.update_avatar_profile_summary(
            avatar_id=avatar_id,
            status="completed",
            summary=summary,
            generated_at=generated_at,
            source_hash=source_hash,
            error=None,
        )
        return {
            "avatar_id": avatar_id,
            "profile_summary": summary,
            "status": "completed",
            "generated_at": generated_at,
            "cached": False,
            "website_summary_status": website_status,
        }
    except Exception as exc:
        error_message = str(exc)
        logger.error(
            "profile_summary generation failed",
            extra={"avatar_id": avatar_id, "user_id": user_id, "error": error_message},
        )
        db.update_avatar_profile_summary(
            avatar_id=avatar_id,
            status="failed",
            error=error_message[:2000],
        )
        raise ProfileSummaryError(error_message) from exc


def maybe_refresh_stale_profile_summary(
    row: dict[str, Any],
    user_id: str,
) -> dict[str, Any] | None:
    """Lazy single-attempt refresh when summary missing but profiling answers exist."""
    status = row.get("profile_summary_status") or "pending"
    if status == "generating":
        return None
    if row.get("profile_summary"):
        return None
    profiling = row.get("profiling_data") or {}
    if not isinstance(profiling, dict) or not profiling:
        return None
    if status not in {"pending", "failed"}:
        return None

    try:
        result = generate_and_store_profile_summary(
            avatar_id=str(row["id"]),
            user_id=user_id,
            force=False,
        )
        return result
    except ProfileSummaryError as exc:
        logger.warning(
            "lazy profile_summary refresh failed avatar_id=%s: %s",
            row.get("id"),
            exc,
        )
        return None
