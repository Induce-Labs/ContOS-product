"""Celery application for ContOS Backend scrape queue."""

from celery import Celery

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "contos_backend",
    broker=settings.redis_url,
    include=["app.tasks.pipeline"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    # Restore unacked messages if a worker dies mid-task (default 1h is too long).
    broker_transport_options={
        "visibility_timeout": max(settings.celery_task_time_limit + 60, 960),
    },
    task_soft_time_limit=settings.celery_task_soft_time_limit,
    task_time_limit=settings.celery_task_time_limit,
    task_default_queue="scrape",
    task_routes={
        "pipeline.run_competitor": {"queue": "scrape"},
    },
)

# Alias for `celery -A app.celery_app worker`
app = celery_app
