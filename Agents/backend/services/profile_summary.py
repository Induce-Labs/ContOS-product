"""Profiling completion: website crawl + Supermemory profile sync enqueue.

LLM generation of ``avatars.profile_summary`` is disabled. Historical summary
columns are left untouched. Strategists read profile context from Supermemory.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from context.profiling_data import format_profiling_qa_for_prompt, profiling_data_hash
from services.website_summary import WebsiteSummaryError, generate_and_store_website_summary

logger = logging.getLogger(__name__)


class ProfileSummaryError(Exception):
    """Raised when profiling completion or persistence fails."""


@dataclass(frozen=True)
class ProfileSyncOutcome:
    """Result of one profile sync attempt. It never changes Supabase."""

    ok: bool
    retryable: bool
    error: str | None = None
    operation: str | None = None
    status_code: int | None = None
    retry_after_seconds: int | None = None


def build_profile_summary_prompt(avatar: dict[str, Any]) -> str:
    """Legacy helper retained for tests/docs. Not used by the completion path."""
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

    lines.append(
        "(LLM profile-summary generation is disabled; answers sync to Supermemory.)"
    )
    return "\n".join(lines)


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
            "website_summary step failed (continuing profiling completion)",
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
            "website_summary step unexpected failure (continuing profiling completion)",
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
    schedule_sync: bool = True,
) -> dict[str, Any]:
    """Complete profiling: website summary + mark ready + enqueue Supermemory sync.

    Does not call an LLM and does not overwrite historical ``profile_summary``
    text. Updates ``profile_summary_status`` / ``source_hash`` so the frontend
    poll and Celery skip logic keep working.
    """
    from db import supabase_client as db
    from services.contos_flow_log import flow_log, short_id

    flow_log("PROFILING", "Started", avatar=short_id(avatar_id), force=force)
    row = db.assert_avatar_owned(avatar_id, user_id)
    profiling = row.get("profiling_data") or {}
    if not isinstance(profiling, dict) or not format_profiling_qa_for_prompt(profiling):
        raise ProfileSummaryError(
            f"Avatar {avatar_id} has no profiling answers to process."
        )
    source_hash = profiling_data_hash(profiling)
    existing_status = str(row.get("profile_summary_status") or "").strip() or "pending"
    flow_log(
        "PROFILING",
        "Loaded avatar profiling context from Supabase",
        avatar=short_id(avatar_id),
        summary_status=existing_status,
        profiling_answers="yes",
        source="Supabase",
        llm_summary="disabled",
    )

    website_result = _run_website_summary_best_effort(
        avatar_id=avatar_id,
        row=row,
        force=force,
    )
    website_status = str(website_result.get("status") or "failed")
    website_summary = website_result.get("website_summary")
    website_cached = bool(website_result.get("cached"))
    flow_log(
        "PROFILING",
        "Website context step finished",
        avatar=short_id(avatar_id),
        website_status=website_status,
        website_cached=("yes" if website_cached else "no"),
        source=(
            "website_cache"
            if website_cached
            else ("website_scraping" if website_status == "completed" else "none")
        ),
    )

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

    website_requires_refresh = (
        not website_cached and website_status == "completed" and isinstance(website_summary, str)
    )

    if not force and not website_requires_refresh:
        status = row.get("profile_summary_status")
        cached_hash = row.get("profile_summary_source_hash")
        if status == "completed" and cached_hash == source_hash:
            flow_log(
                "PROFILING",
                "Profiling already processed for current answers",
                source="Supabase",
                action="used_cached",
                avatar=short_id(avatar_id),
            )
            sync_enqueued = _enqueue_completed_profile_sync(
                avatar_id=avatar_id,
                user_id=user_id,
                schedule_sync=schedule_sync,
            )
            flow_log(
                "PROFILING",
                "Completed",
                avatar=short_id(avatar_id),
                cached="yes",
                persisted="already",
                profile_sync_enqueued=("yes" if sync_enqueued else "no"),
            )
            return {
                "avatar_id": avatar_id,
                "profile_summary": row.get("profile_summary"),
                "status": "completed",
                "generated_at": row.get("profile_summary_generated_at"),
                "cached": True,
                "website_summary_status": website_status,
                "profile_sync_enqueued": sync_enqueued,
            }

    flow_log(
        "PROFILING",
        "Marking profiling ready for Supermemory sync",
        avatar=short_id(avatar_id),
        context_sources="Supabase+website" if website_status == "completed" else "Supabase",
    )
    db.update_avatar_profile_summary(
        avatar_id=avatar_id,
        status="generating",
        error=None,
    )

    try:
        generated_at = datetime.now(timezone.utc).isoformat()
        # Do not pass summary= — leave historical profile_summary text intact.
        db.update_avatar_profile_summary(
            avatar_id=avatar_id,
            status="completed",
            generated_at=generated_at,
            source_hash=source_hash,
            error=None,
        )
        flow_log(
            "PROFILING",
            "Profiling marked completed (no LLM summary)",
            avatar=short_id(avatar_id),
            status="completed",
        )
    except Exception as exc:
        error_message = str(exc)
        logger.error(
            "profiling completion failed",
            extra={"avatar_id": avatar_id, "user_id": user_id, "error": error_message},
        )
        db.update_avatar_profile_summary(
            avatar_id=avatar_id,
            status="failed",
            error=error_message[:2000],
        )
        flow_log(
            "PROFILING",
            "Profiling completion failed",
            avatar=short_id(avatar_id),
            error=type(exc).__name__,
        )
        raise ProfileSummaryError(error_message) from exc

    sync_enqueued = _enqueue_completed_profile_sync(
        avatar_id=avatar_id,
        user_id=user_id,
        schedule_sync=schedule_sync,
    )
    flow_log(
        "PROFILING",
        "Completed",
        avatar=short_id(avatar_id),
        cached="no",
        persisted="yes",
        profile_sync_enqueued=("yes" if sync_enqueued else "no"),
    )
    return {
        "avatar_id": avatar_id,
        "profile_summary": row.get("profile_summary"),
        "status": "completed",
        "generated_at": generated_at,
        "cached": False,
        "website_summary_status": website_status,
        "profile_sync_enqueued": sync_enqueued,
    }


def _enqueue_completed_profile_sync(
    *,
    avatar_id: str,
    user_id: str,
    schedule_sync: bool,
) -> bool:
    """Publish the sync task after the summary is stored. Never raises."""
    if not schedule_sync:
        return False
    from services.enqueue_profile_sync import schedule_profile_sync

    return schedule_profile_sync(avatar_id=avatar_id, user_id=user_id)


def sync_stored_profile_to_supermemory(
    *,
    avatar_id: str,
    user_id: str,
    retry_attempt: int = 0,
) -> ProfileSyncOutcome:
    """Reload the owned avatar and sync its completed profile.

    The avatar is reloaded after this call acquires the per-avatar sync lock,
    so an older attempt cannot overwrite a newer stored profile. Failures are
    logged and do not change ``profile_summary_status``.
    """
    from services.job_lock import (
        PROFILE_SYNC_LOCK_TTL_SECS,
        acquire_job_lock,
        profile_sync_lock_key,
    )

    from services.contos_flow_log import flow_log, short_id

    flow_log(
        "PROFILE_SYNC",
        "Started",
        destination="Supermemory",
        avatar=short_id(avatar_id),
        retry_attempt=retry_attempt,
    )
    try:
        with acquire_job_lock(
            profile_sync_lock_key(avatar_id),
            ttl_secs=PROFILE_SYNC_LOCK_TTL_SECS,
        ) as acquired:
            if not acquired:
                logger.info(
                    "profile supermemory sync deferred",
                    extra={
                        "avatar_id": avatar_id,
                        "error": "lock_held",
                        "retry_attempt": retry_attempt,
                    },
                )
                flow_log(
                    "PROFILE_SYNC",
                    "Deferred",
                    error="lock_held",
                    avatar=short_id(avatar_id),
                )
                return ProfileSyncOutcome(ok=False, retryable=True, error="lock_held")
            return _sync_locked_profile(
                avatar_id=avatar_id,
                user_id=user_id,
                retry_attempt=retry_attempt,
            )
    except Exception as exc:
        from celery.exceptions import SoftTimeLimitExceeded

        if isinstance(exc, SoftTimeLimitExceeded):
            raise
        logger.warning(
            "profile supermemory sync lock failed",
            extra={
                "avatar_id": avatar_id,
                "error_type": type(exc).__name__,
                "retry_attempt": retry_attempt,
            },
        )
        return ProfileSyncOutcome(ok=False, retryable=True, error="lock_unavailable")


def _sync_locked_profile(
    *,
    avatar_id: str,
    user_id: str,
    retry_attempt: int,
) -> ProfileSyncOutcome:
    """Load owned avatar questionnaire (+ website) and write the SM profile doc."""
    from services.contos_flow_log import flow_log, short_id
    from services.profile_sync_policy import profile_sync_is_retryable

    try:
        from db import supabase_client as db
        from services.supermemory import sync_profile_to_supermemory

        row = db.assert_avatar_owned(avatar_id, user_id)
        status = str(row.get("profile_summary_status") or "").strip().lower()
        profiling = row.get("profiling_data")
        if not isinstance(profiling, dict):
            profiling = {}
        has_answers = bool(format_profiling_qa_for_prompt(profiling))
        if status != "completed" or not has_answers:
            logger.info(
                "profile supermemory sync skipped",
                extra={
                    "avatar_id": avatar_id,
                    "profile_summary_status": status or None,
                    "retry_attempt": retry_attempt,
                    "has_profiling_answers": has_answers,
                },
            )
            flow_log(
                "PROFILE_SYNC",
                "Skipped",
                reason="profiling_not_ready",
                summary_status=status or "none",
                avatar=short_id(avatar_id),
            )
            return ProfileSyncOutcome(ok=False, retryable=False, error="skipped")
        owned_avatar_id = str(row.get("id") or "").strip()
        if not owned_avatar_id:
            logger.warning(
                "profile supermemory sync skipped",
                extra={
                    "avatar_id": avatar_id,
                    "error": "invalid_request",
                    "retry_attempt": retry_attempt,
                },
            )
            flow_log(
                "PROFILE_SYNC",
                "Skipped",
                error="invalid_request",
                avatar=short_id(avatar_id),
            )
            return ProfileSyncOutcome(ok=False, retryable=False, error="invalid_request")
        website_summary = row.get("website_summary")
        if not isinstance(website_summary, str):
            website_summary = None
        flow_log(
            "PROFILE_SYNC",
            "Loaded profiling answers from Supabase for sync",
            avatar=short_id(owned_avatar_id),
            source="Supabase",
            has_website=("yes" if website_summary and website_summary.strip() else "no"),
        )
        result = sync_profile_to_supermemory(
            avatar_id=owned_avatar_id,
            profiling_data=profiling,
            website_summary=website_summary,
            retry_attempt=retry_attempt,
        )
    except Exception as exc:
        from celery.exceptions import SoftTimeLimitExceeded

        if isinstance(exc, SoftTimeLimitExceeded):
            raise
        logger.warning(
            "profile supermemory sync failed",
            extra={
                "avatar_id": avatar_id,
                "error_type": type(exc).__name__,
                "retry_attempt": retry_attempt,
            },
        )
        flow_log(
            "PROFILE_SYNC",
            "Failed",
            error=type(exc).__name__,
            avatar=short_id(avatar_id),
        )
        return ProfileSyncOutcome(ok=False, retryable=False, error="unexpected")

    flow_log(
        "PROFILE_SYNC",
        "Completed",
        ok=("yes" if result.ok else "no"),
        operation=result.operation,
        status_code=result.status_code,
        error=result.error,
        avatar=short_id(avatar_id),
    )
    return ProfileSyncOutcome(
        ok=result.ok,
        retryable=profile_sync_is_retryable(result.error, result.status_code),
        error=result.error,
        operation=result.operation,
        status_code=result.status_code,
        retry_after_seconds=result.retry_after_seconds,
    )


def maybe_refresh_stale_profile_summary(
    row: dict[str, Any],
    user_id: str,
) -> dict[str, Any] | None:
    """No-op: LLM profile-summary refresh on avatar load is disabled.

    Profiling completion + Supermemory sync run only through the Celery
    ``profiling.run_summarize`` path (and explicit summarize API enqueue).
    """
    _ = (row, user_id)
    return None
