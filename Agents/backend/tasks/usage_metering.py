"""Celery tasks for ContOS usage metering (Supermemory OpenRouter activity)."""

from __future__ import annotations

import logging

from celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    bind=True,
    name="usage.ingest_supermemory_openrouter",
    max_retries=2,
)
def ingest_supermemory_openrouter_task(
    self,
    usage_date: str | None = None,
) -> dict:
    """Ingest prior-day (or given UTC date) SM OpenRouter activity into usage_events."""
    from celery_app import ensure_backend_on_path

    ensure_backend_on_path()

    from services.openrouter_analytics import OpenRouterAnalyticsError
    from services.supermemory_usage_ingest import ingest_supermemory_openrouter_usage

    try:
        summary = ingest_supermemory_openrouter_usage(usage_date=usage_date)
    except OpenRouterAnalyticsError as exc:
        logger.error(
            "supermemory openrouter ingest failed: %s",
            exc,
        )
        raise
    except Exception as exc:
        logger.error(
            "supermemory openrouter ingest unexpected failure: %s",
            exc,
        )
        raise

    logger.info(
        "supermemory openrouter ingest task done date=%s inserted=%s skipped=%s",
        summary.get("usage_date"),
        len(summary.get("inserted") or []),
        len(summary.get("skipped") or []),
    )
    return summary
