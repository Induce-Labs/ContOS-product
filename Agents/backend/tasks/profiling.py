"""Celery tasks for website crawl + profile summarization."""

from __future__ import annotations

import logging
import os

from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded

from celery_app import celery_app
from clients.apify_website import WebsiteCrawlError
from services.job_lock import acquire_job_lock, profiling_lock_key

logger = logging.getLogger(__name__)

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

    ensure_backend_on_path()

    lock_key = profiling_lock_key(avatar_id)
    with acquire_job_lock(lock_key, ttl_secs=HARD_LIMIT) as acquired:
        if not acquired:
            logger.info(
                "Skipping profiling task; lock held",
                extra={"avatar_id": avatar_id, "user_id": user_id},
            )
            return

        try:
            if _should_skip(avatar_id=avatar_id, user_id=user_id, force=force):
                return
            from services.profile_summary import generate_and_store_profile_summary

            generate_and_store_profile_summary(
                avatar_id=avatar_id,
                user_id=user_id,
                force=force,
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

    cached_summary = row.get("profile_summary")
    cached_hash = row.get("profile_summary_source_hash")
    if (
        profile_status == "completed"
        and isinstance(cached_summary, str)
        and cached_summary.strip()
        and cached_hash == source_hash
    ):
        logger.info(
            "Skipping profiling task; already completed",
            extra={"avatar_id": avatar_id, "user_id": user_id},
        )
        return True

    # In-flight generating without completed cache: proceed when we hold the lock
    # (covers crash/requeue). Concurrent doubles are blocked by the lock.
    return False
