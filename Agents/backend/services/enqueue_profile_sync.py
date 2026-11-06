"""Publish the profile sync task, and recover when publication fails.

Publication retries are short Redis retries. They do not call Supermemory.
If the broker is still unavailable, the profiling worker runs the sync after
it has released the profiling lock. Agent context loading does not use that
fallback, because it must not wait on Supermemory.
"""

from __future__ import annotations

import logging
import time

from services.profile_sync_policy import (
    PROFILE_SYNC_MAX_RETRIES,
    PROFILE_SYNC_PUBLISH_ATTEMPTS,
    PROFILE_SYNC_PUBLISH_BACKOFF_SECS,
    profile_sync_retry_delay,
)

logger = logging.getLogger(__name__)


def schedule_profile_sync(*, avatar_id: str, user_id: str) -> bool:
    """Publish one profile sync job. Return False when publication fails.

    The stored Supabase profile is left unchanged. A False return is logged
    at error level so the missed publication is visible.
    """
    if not str(avatar_id).strip() or not str(user_id).strip():
        logger.warning(
            "profile sync publish rejected",
            extra={"avatar_id": avatar_id, "error": "invalid_request"},
        )
        return False

    try:
        from services.supermemory import is_supermemory_configured

        if not is_supermemory_configured():
            logger.debug(
                "profile sync publish skipped",
                extra={"avatar_id": avatar_id, "error": "missing_configuration"},
            )
            return True
    except Exception as exc:
        logger.error(
            "profile sync was not published; stored profile remains in Supabase",
            extra={"avatar_id": avatar_id, "error_type": type(exc).__name__},
        )
        return False

    last_error_type = "unknown"
    last_error_detail = ""
    for attempt in range(PROFILE_SYNC_PUBLISH_ATTEMPTS):
        try:
            # Prefer send_task by name so a worker executing run_summarize does
            # not re-import tasks.profiling (nested apply_async import failures).
            from celery_app import celery_app

            celery_app.send_task(
                "profiling.sync_profile",
                args=[str(avatar_id), str(user_id)],
                queue="website",
            )
        except Exception as exc:
            last_error_type = type(exc).__name__
            last_error_detail = str(exc).strip()[:180]
            logger.warning(
                "profile sync publish attempt failed",
                extra={
                    "avatar_id": avatar_id,
                    "retry_attempt": attempt,
                    "error_type": last_error_type,
                    "error_detail": last_error_detail,
                },
            )
            if attempt + 1 >= PROFILE_SYNC_PUBLISH_ATTEMPTS:
                break
            time.sleep(PROFILE_SYNC_PUBLISH_BACKOFF_SECS * (2**attempt))
            continue
        logger.info(
            "profile sync enqueued",
            extra={"avatar_id": avatar_id, "retry_attempt": attempt},
        )
        from services.contos_flow_log import flow_context, flow_log, short_id

        with flow_context(user_id=user_id, avatar_id=avatar_id):
            flow_log(
                "PROFILE_SYNC",
                "Sync task enqueued",
                avatar=short_id(avatar_id),
                queue="website",
                retry_attempt=attempt,
                destination="Supermemory",
            )
        return True

    logger.error(
        "profile sync was not published; stored profile remains in Supabase",
        extra={
            "avatar_id": avatar_id,
            "error_type": last_error_type,
            "error_detail": last_error_detail,
        },
    )
    from services.contos_flow_log import flow_context, flow_log, short_id

    with flow_context(user_id=user_id, avatar_id=avatar_id):
        flow_log(
            "PROFILE_SYNC",
            "Sync publish failed",
            avatar=short_id(avatar_id),
            error=last_error_type,
            detail=last_error_detail or None,
        )
    return False


def recover_profile_sync_after_publish_failure(*, avatar_id: str, user_id: str) -> None:
    """Sync in-process after the profiling lock has been released.

    Celery cannot retry a task that was never published. This uses the same
    attempt limit and backoff as the sync task. It does not change
    ``profile_summary_status`` and it does not raise.
    """
    from services.profile_summary import sync_stored_profile_to_supermemory

    logger.error(
        "profile sync publish failed; syncing after the profiling lock",
        extra={"avatar_id": avatar_id},
    )
    from services.contos_flow_log import flow_context, flow_log, short_id

    with flow_context(user_id=user_id, avatar_id=avatar_id):
        flow_log(
            "PROFILE_SYNC",
            "Recovering in-process after publish failure",
            avatar=short_id(avatar_id),
            destination="Supermemory",
        )
    attempts = PROFILE_SYNC_MAX_RETRIES + 1
    for attempt in range(attempts):
        try:
            with flow_context(user_id=user_id, avatar_id=avatar_id):
                outcome = sync_stored_profile_to_supermemory(
                    avatar_id=avatar_id,
                    user_id=user_id,
                    retry_attempt=attempt,
                )
        except Exception as exc:
            logger.warning(
                "profile sync recovery failed",
                extra={"avatar_id": avatar_id, "error_type": type(exc).__name__},
            )
            return
        if outcome.ok or not outcome.retryable:
            if not outcome.ok:
                logger.warning(
                    "profile sync recovery stopped",
                    extra={
                        "avatar_id": avatar_id,
                        "operation": outcome.operation,
                        "error": outcome.error,
                        "status_code": outcome.status_code,
                        "retry_attempt": attempt,
                    },
                )
            return
        if attempt + 1 >= attempts:
            logger.error(
                "profile sync recovery exhausted",
                extra={
                    "avatar_id": avatar_id,
                    "operation": outcome.operation,
                    "error": outcome.error,
                    "status_code": outcome.status_code,
                    "retry_attempt": attempt,
                },
            )
            return
        time.sleep(
            profile_sync_retry_delay(attempt, outcome.retry_after_seconds)
        )
