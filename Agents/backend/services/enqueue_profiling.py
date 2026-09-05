"""Enqueue profiling summarize jobs onto the Celery website queue."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


class EnqueueProfilingError(Exception):
    """Raised when profiling jobs cannot be published to Redis/Celery."""


def enqueue_profiling_summarize(
    *,
    avatar_id: str,
    user_id: str,
    force: bool = False,
) -> None:
    """Publish one Celery website-queue task. Raises if the broker is down."""
    try:
        from tasks.profiling import run_summarize_task
    except Exception as error:
        raise EnqueueProfilingError(
            f"Failed to load profiling Celery task: {error}",
        ) from error

    try:
        run_summarize_task.apply_async(
            args=[avatar_id, user_id, force],
            queue="website",
        )
    except Exception as error:
        logger.error(
            "Failed to enqueue profiling summarize job",
            extra={"avatar_id": avatar_id, "user_id": user_id, "error": str(error)},
        )
        raise EnqueueProfilingError(
            "Failed to enqueue profiling summarize: Redis broker is unreachable. "
            "Check REDIS_URL and that Redis is running.",
        ) from error

    logger.info(
        "Enqueued profiling summarize task",
        extra={"avatar_id": avatar_id, "user_id": user_id, "force": force},
    )
