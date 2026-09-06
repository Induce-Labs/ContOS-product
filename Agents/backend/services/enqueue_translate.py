"""Enqueue translation jobs onto the Celery website queue."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


class EnqueueTranslateError(Exception):
    """Raised when translation jobs cannot be published to Redis/Celery."""


def enqueue_translate_content(
    *,
    target_lang: str,
    source_lang: str = "en",
    text: str | None = None,
    texts: list[str] | None = None,
) -> None:
    """Publish one Celery website-queue translation task. Raises if broker is down."""
    try:
        from tasks.translate import translate_content_task
    except Exception as error:
        raise EnqueueTranslateError(
            f"Failed to load translate Celery task: {error}",
        ) from error

    try:
        translate_content_task.apply_async(
            kwargs={
                "target_lang": target_lang,
                "source_lang": source_lang,
                "text": text,
                "texts": texts,
            },
            queue="website",
        )
    except Exception as error:
        logger.error(
            "Failed to enqueue translation job",
            extra={
                "target_lang": target_lang,
                "source_lang": source_lang,
                "error": str(error),
            },
        )
        raise EnqueueTranslateError(
            "Failed to enqueue translation: Redis broker is unreachable. "
            "Check REDIS_URL and that Redis is running.",
        ) from error

    logger.info(
        "Enqueued translation task",
        extra={
            "target_lang": target_lang,
            "source_lang": source_lang,
            "text_count": len(texts) if texts is not None else (1 if text else 0),
        },
    )
