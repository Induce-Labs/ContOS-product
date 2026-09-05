"""Enqueue competitor scrape jobs onto the Celery scrape queue."""

from __future__ import annotations

import logging
from uuid import UUID

from app.errors import ConfigurationError

logger = logging.getLogger(__name__)


class EnqueueError(ConfigurationError):
    """Raised when scrape jobs cannot be published to Redis/Celery."""


def enqueue_competitor_jobs(avatar_id: UUID, competitor_ids: list[UUID]) -> None:
    """Publish one Celery task per competitor. Raises EnqueueError if the broker is down."""
    if not competitor_ids:
        return

    try:
        from app.tasks.pipeline import run_competitor_task
    except Exception as error:
        raise EnqueueError(
            f"Failed to load scrape Celery task: {error}",
        ) from error

    try:
        for competitor_id in competitor_ids:
            run_competitor_task.apply_async(
                args=[str(avatar_id), str(competitor_id)],
                queue="scrape",
            )
    except Exception as error:
        logger.error(
            "Failed to enqueue competitor scrape jobs",
            extra={
                "avatar_id": str(avatar_id),
                "competitor_count": len(competitor_ids),
                "error": str(error),
            },
        )
        raise EnqueueError(
            "Failed to enqueue scrape jobs: Redis broker is unreachable. "
            "Check REDIS_URL and that Redis is running.",
        ) from error

    logger.info(
        "Enqueued competitor scrape tasks",
        extra={
            "avatar_id": str(avatar_id),
            "competitor_ids": [str(cid) for cid in competitor_ids],
        },
    )
