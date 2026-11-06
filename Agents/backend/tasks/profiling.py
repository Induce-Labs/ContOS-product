"""Celery tasks for website crawl + profile summarization."""

from __future__ import annotations

import logging
import os

from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded

from celery_app import celery_app
from clients.apify_website import WebsiteCrawlError
from services.job_lock import acquire_job_lock, profiling_lock_key
from services.profile_sync_policy import PROFILE_SYNC_MAX_RETRIES, profile_sync_retry_delay

logger = logging.getLogger(__name__)


class ProfileSyncRetryable(Exception):
    """Retryable Supermemory failure. The message is an error code only."""

RATE_LIMIT = os.getenv("CELERY_WEBSITE_RATE_LIMIT", "6/m")
MAX_RETRIES = int(os.getenv("CELERY_TASK_MAX_RETRIES", "2"))
RETRY_BACKOFF = int(os.getenv("CELERY_TASK_RETRY_BACKOFF", "15"))
HARD_LIMIT = int(os.getenv("CELERY_TASK_TIME_LIMIT", "360"))


@celery_app.task(
    bind=True,
    name="profiling.run_summarize",
    max_retries=MAX_RETRIES,
    rate_limit=RATE_LIMIT,
)
def run_summarize_task(self, avatar_id: str, user_id: str, force: bool = False) -> None:
    """Run website crawl + profile summary with lock and idempotency skip."""
    # Celery can rewrite sys.path after boot; re-bind before deferred imports.
    from celery_app import ensure_backend_on_path
    from services.contos_flow_log import flow_context, flow_log, short_id

    ensure_backend_on_path()

    lock_key = profiling_lock_key(avatar_id)
    should_sync = False
    with flow_context(user_id=user_id, avatar_id=avatar_id):
        flow_log(
            "PROFILING",
            "Celery summarize task started",
            avatar=short_id(avatar_id),
            force=force,
        )
        with acquire_job_lock(lock_key, ttl_secs=HARD_LIMIT) as acquired:
            if not acquired:
                logger.info(
                    "Skipping profiling task; lock held",
                    extra={"avatar_id": avatar_id, "user_id": user_id},
                )
                flow_log(
                    "PROFILING",
                    "Celery summarize skipped",
                    reason="lock_held",
                    avatar=short_id(avatar_id),
                )
                return

            try:
                if _should_skip(avatar_id=avatar_id, user_id=user_id, force=force):
                    flow_log(
                        "PROFILING",
                        "Celery summarize skipped",
                        reason="already_completed",
                        avatar=short_id(avatar_id),
                    )
                else:
                    from services.profile_summary import generate_and_store_profile_summary

                    generated = generate_and_store_profile_summary(
                        avatar_id=avatar_id,
                        user_id=user_id,
                        force=force,
                        schedule_sync=False,
                    )
                    # Always sync after a non-skipped run so SM stays primary
                    # even when website/hash caching short-circuits the LLM-less path.
                    should_sync = True
                    flow_log(
                        "PROFILING",
                        "Celery summarize finished",
                        avatar=short_id(avatar_id),
                        cached=("yes" if generated.get("cached") else "no"),
                        will_enqueue_profile_sync=("yes" if should_sync else "no"),
                    )
            except SoftTimeLimitExceeded:
                logger.error(
                    "Profiling summarize hit soft time limit",
                    extra={"avatar_id": avatar_id, "user_id": user_id},
                )
                raise
            except (WebsiteCrawlError, OSError, TimeoutError) as error:
                logger.warning(
                    "Retryable profiling error",
                    extra={
                        "avatar_id": avatar_id,
                        "user_id": user_id,
                        "error": str(error),
                        "retries": self.request.retries,
                    },
                )
                try:
                    raise self.retry(
                        exc=error,
                        countdown=RETRY_BACKOFF * (2**self.request.retries),
                    ) from error
                except MaxRetriesExceededError:
                    raise error from error
            except Exception as error:
                # ProfileSummaryError and ownership errors are non-retryable.
                from services.profile_summary import ProfileSummaryError

                if isinstance(error, ProfileSummaryError):
                    message = str(error).lower()
                    if "credit" in message or "timeout" in message or "429" in message:
                        try:
                            raise self.retry(
                                exc=error,
                                countdown=RETRY_BACKOFF * (2**self.request.retries),
                            ) from error
                        except MaxRetriesExceededError:
                            raise error from error
                logger.error(
                    "Non-retryable profiling error",
                    extra={
                        "avatar_id": avatar_id,
                        "user_id": user_id,
                        "error": str(error),
                    },
                )
                raise

    if should_sync:
        _schedule_profile_sync_after_lock(avatar_id=avatar_id, user_id=user_id)


def _schedule_profile_sync_after_lock(*, avatar_id: str, user_id: str) -> None:
    """Publish profile sync only after the profiling lock has been released."""
    from services.enqueue_profile_sync import (
        recover_profile_sync_after_publish_failure,
        schedule_profile_sync,
    )

    try:
        published = schedule_profile_sync(avatar_id=avatar_id, user_id=user_id)
    except Exception as exc:
        logger.warning(
            "profile sync publish failed",
            extra={"avatar_id": avatar_id, "error_type": type(exc).__name__},
        )
        published = False
    if published:
        return
    try:
        recover_profile_sync_after_publish_failure(
            avatar_id=avatar_id,
            user_id=user_id,
        )
    except Exception as exc:
        logger.warning(
            "profile sync recovery failed",
            extra={"avatar_id": avatar_id, "error_type": type(exc).__name__},
        )


@celery_app.task(
    bind=True,
    name="profiling.sync_profile",
    max_retries=PROFILE_SYNC_MAX_RETRIES,
    soft_time_limit=45,
    time_limit=60,
)
def run_profile_sync_task(self, avatar_id: str, user_id: str) -> None:
    """Sync one stored profile. This task does not generate a summary."""
    from celery_app import ensure_backend_on_path
    from services.contos_flow_log import flow_context, flow_log, short_id

    ensure_backend_on_path()
    from services.profile_summary import sync_stored_profile_to_supermemory

    retry_attempt = int(getattr(self.request, "retries", 0) or 0)
    with flow_context(user_id=user_id, avatar_id=avatar_id):
        flow_log(
            "PROFILE_SYNC",
            "Celery sync task started",
            avatar=short_id(avatar_id),
            retry_attempt=retry_attempt,
        )
        try:
            outcome = sync_stored_profile_to_supermemory(
                avatar_id=avatar_id,
                user_id=user_id,
                retry_attempt=retry_attempt,
            )
        except SoftTimeLimitExceeded:
            outcome = None
        if outcome is None:
            flow_log(
                "PROFILE_SYNC",
                "Celery sync timed out; will retry",
                avatar=short_id(avatar_id),
                retry_attempt=retry_attempt,
            )
            _retry_profile_sync(
                self,
                avatar_id=avatar_id,
                error="timeout",
                operation="sync_profile",
                status_code=None,
                retry_attempt=retry_attempt,
                countdown=profile_sync_retry_delay(retry_attempt),
            )
        if outcome.ok or not outcome.retryable:
            if not outcome.ok and outcome.error != "missing_configuration":
                logger.warning(
                    "profile sync stopped",
                    extra={
                        "avatar_id": avatar_id,
                        "operation": outcome.operation,
                        "error": outcome.error,
                        "status_code": outcome.status_code,
                        "retry_attempt": retry_attempt,
                    },
                )
            flow_log(
                "PROFILE_SYNC",
                "Celery sync task finished",
                avatar=short_id(avatar_id),
                ok=("yes" if outcome.ok else "no"),
                error=outcome.error,
                retry_attempt=retry_attempt,
            )
            return

        flow_log(
            "PROFILE_SYNC",
            "Celery sync will retry",
            avatar=short_id(avatar_id),
            error=outcome.error or "http_error",
            status_code=outcome.status_code,
            retry_attempt=retry_attempt,
        )
        _retry_profile_sync(
            self,
            avatar_id=avatar_id,
            error=outcome.error or "http_error",
            operation=outcome.operation,
            status_code=outcome.status_code,
            retry_attempt=retry_attempt,
            countdown=profile_sync_retry_delay(
                retry_attempt, outcome.retry_after_seconds
            ),
        )


def _retry_profile_sync(
    task: object,
    *,
    avatar_id: str,
    error: str,
    operation: str | None,
    status_code: int | None,
    retry_attempt: int,
    countdown: int,
) -> None:
    """Schedule another attempt, or stop when the retry budget is spent.

    Celery re-raises the supplied exception once ``max_retries`` is exceeded,
    so the exhaustion log has to happen before ``Task.retry``.
    """
    request = getattr(task, "request", None)
    retries = int(getattr(request, "retries", 0) or 0)
    max_retries = int(getattr(task, "max_retries", PROFILE_SYNC_MAX_RETRIES))
    if retries >= max_retries:
        logger.error(
            "profile sync retries exhausted",
            extra={
                "avatar_id": avatar_id,
                "operation": operation,
                "error": error,
                "status_code": status_code,
                "retry_attempt": retry_attempt,
            },
        )
        raise ProfileSyncRetryable(error)
    logger.warning(
        "profile sync will retry",
        extra={
            "avatar_id": avatar_id,
            "operation": operation,
            "error": error,
            "status_code": status_code,
            "retry_attempt": retry_attempt,
            "countdown_secs": countdown,
        },
    )
    retry = getattr(task, "retry")
    raise retry(exc=ProfileSyncRetryable(error), countdown=countdown)


def _should_skip(*, avatar_id: str, user_id: str, force: bool) -> bool:
    """Return True when work should be skipped without calling Apify."""
    if force:
        return False

    from context.profiling_data import profiling_data_hash
    from db import supabase_client as db
    from services.website_summary import extract_website_url_from_profiling
    from clients.apify_website import website_url_hash

    row = db.assert_avatar_owned(avatar_id, user_id)
    profile_status = str(row.get("profile_summary_status") or "").strip().lower()
    website_status = str(row.get("website_summary_status") or "").strip().lower()

    profiling = row.get("profiling_data") or {}
    source_hash = profiling_data_hash(profiling)

    website_needs_work = False
    try:
        website_url = extract_website_url_from_profiling(profiling)
    except Exception:
        website_url = None

    if website_url:
        url_hash = website_url_hash(website_url)
        cached_hash = row.get("website_summary_source_hash")
        cached_summary = row.get("website_summary")
        if not (
            website_status == "completed"
            and isinstance(cached_summary, str)
            and cached_summary.strip()
            and cached_hash == url_hash
        ):
            website_needs_work = True

    if website_needs_work:
        return False

    cached_hash = row.get("profile_summary_source_hash")
    if profile_status == "completed" and cached_hash == source_hash:
        logger.info(
            "Skipping profiling task; already completed",
            extra={"avatar_id": avatar_id, "user_id": user_id},
        )
        return True

    # In-flight generating without completed cache: proceed when we hold the lock
    # (covers crash/requeue). Concurrent doubles are blocked by the lock.
    return False
