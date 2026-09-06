"""Celery tasks for on-demand content translation."""

from __future__ import annotations

import logging
import os

from celery.exceptions import MaxRetriesExceededError, SoftTimeLimitExceeded

from celery_app import celery_app

logger = logging.getLogger(__name__)

RATE_LIMIT = os.getenv("CELERY_WEBSITE_RATE_LIMIT", "6/m")
MAX_RETRIES = int(os.getenv("CELERY_TASK_MAX_RETRIES", "2"))
RETRY_BACKOFF = int(os.getenv("CELERY_TASK_RETRY_BACKOFF", "15"))


def _is_retryable_translation_error(error: BaseException) -> bool:
    message = str(error).lower()
    return (
        "429" in message
        or "timeout" in message
        or "timed out" in message
        or "credit" in message
        or "rate limit" in message
        or "503" in message
        or "502" in message
    )


@celery_app.task(
    bind=True,
    name="translate.translate_content",
    max_retries=MAX_RETRIES,
    rate_limit=RATE_LIMIT,
)
def translate_content_task(
    self,
    target_lang: str,
    source_lang: str = "en",
    text: str | None = None,
    texts: list[str] | None = None,
) -> None:
    """Warm translation cache for one or many strings (website queue)."""
    from celery_app import ensure_backend_on_path

    ensure_backend_on_path()

    from services.translate import TranslationError, translate_batch, translate_content

    if texts is None and text is None:
        raise TranslationError("translate_content task requires text or texts.")
    if texts is not None and text is not None:
        raise TranslationError("Pass either text or texts, not both.")

    try:
        if texts is not None:
            translate_batch(texts, target_lang=target_lang, source_lang=source_lang)
        else:
            assert text is not None
            translate_content(text, target_lang=target_lang, source_lang=source_lang)
    except SoftTimeLimitExceeded:
        logger.error(
            "Translation task hit soft time limit",
            extra={"target_lang": target_lang, "source_lang": source_lang},
        )
        raise
    except (OSError, TimeoutError) as error:
        logger.warning(
            "Retryable translation transport error",
            extra={
                "target_lang": target_lang,
                "source_lang": source_lang,
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
    except TranslationError as error:
        if _is_retryable_translation_error(error):
            logger.warning(
                "Retryable translation error",
                extra={
                    "target_lang": target_lang,
                    "source_lang": source_lang,
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
        logger.error(
            "Non-retryable translation error",
            extra={
                "target_lang": target_lang,
                "source_lang": source_lang,
                "error": str(error),
            },
        )
        raise
