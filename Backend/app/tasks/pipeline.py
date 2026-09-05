"""Celery tasks for the competitor scrape pipeline."""

from __future__ import annotations

import logging
from uuid import UUID

from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded

from app.celery_app import celery_app
from app.config import get_settings
from app.errors import ApifyServiceError, ConfigurationError, LlmServiceError, RepositoryError
from app.services.job_lock import acquire_job_lock, competitor_lock_key

logger = logging.getLogger(__name__)


@celery_app.task(
    bind=True,
    name="pipeline.run_competitor",
    max_retries=2,
)
def run_competitor_task(self, avatar_id: str, competitor_id: str) -> None:
    """Run one competitor pipeline job with lock + idempotency skip."""
    settings = get_settings()
    self.max_retries = settings.celery_task_max_retries

    lock_key = competitor_lock_key(competitor_id)
    with acquire_job_lock(lock_key, ttl_secs=settings.celery_task_time_limit) as acquired:
        if not acquired:
            logger.info(
                "Skipping competitor task; lock held",
                extra={"avatar_id": avatar_id, "competitor_id": competitor_id},
            )
            return

        try:
            _run_locked(avatar_id=avatar_id, competitor_id=competitor_id)
        except SoftTimeLimitExceeded as error:
            logger.error(
                "Competitor scrape hit soft time limit",
                extra={"avatar_id": avatar_id, "competitor_id": competitor_id},
            )
            _mark_failed(avatar_id, competitor_id, str(error))
            raise
        except (ApifyServiceError, LlmServiceError) as error:
            logger.warning(
                "Retryable competitor pipeline error",
                extra={
                    "avatar_id": avatar_id,
                    "competitor_id": competitor_id,
                    "error": str(error),
                    "retries": self.request.retries,
                },
            )
            try:
                raise self.retry(
                    exc=error,
                    countdown=settings.celery_task_retry_backoff * (2**self.request.retries),
                ) from error
            except MaxRetriesExceededError:
                _mark_failed(avatar_id, competitor_id, str(error))
                raise error from error
        except (ConfigurationError, RepositoryError) as error:
            logger.error(
                "Non-retryable competitor pipeline error",
                extra={
                    "avatar_id": avatar_id,
                    "competitor_id": competitor_id,
                    "error": str(error),
                },
            )
            _mark_failed(avatar_id, competitor_id, str(error))
            raise
        except Exception as error:
            logger.exception(
                "Competitor pipeline failed",
                extra={
                    "avatar_id": avatar_id,
                    "competitor_id": competitor_id,
                    "error": str(error),
                },
            )
            _mark_failed(avatar_id, competitor_id, str(error))
            raise


def _mark_failed(avatar_id: str, competitor_id: str, error_message: str) -> None:
    from app.services.pipeline import mark_competitor_pipeline_failed

    try:
        mark_competitor_pipeline_failed(
            UUID(avatar_id),
            UUID(competitor_id),
            error_message,
        )
    except Exception as mark_error:
        logger.error(
            "Failed to persist competitor failure status",
            extra={
                "avatar_id": avatar_id,
                "competitor_id": competitor_id,
                "error": str(mark_error),
            },
        )


def _run_locked(*, avatar_id: str, competitor_id: str) -> None:
    from app.clients.supabase_repo import SupabaseRepository
    from app.config import get_settings
    from app.services.pipeline import run_competitor_job

    settings = get_settings()
    repository = SupabaseRepository(settings)
    avatar_uuid = UUID(avatar_id)
    competitor_uuid = UUID(competitor_id)

    competitors = repository.get_competitors_for_avatar(avatar_uuid, [competitor_uuid])
    competitor = competitors[0]
    pipeline_step = str(competitor.get("pipeline_step") or "").strip().lower()

    if pipeline_step == "done":
        logger.info(
            "Skipping competitor task; already done",
            extra={"avatar_id": avatar_id, "competitor_id": competitor_id},
        )
        return

    # In-progress steps are allowed when this worker holds the lock (retry after
    # crash / requeue). Concurrent doubles are blocked by the lock above.
    run_competitor_job(avatar_uuid, competitor_uuid)


run_competitor_task.rate_limit = get_settings().celery_scrape_rate_limit
