"""Celery application for ContOS Agents website queue."""

from __future__ import annotations

import os
import sys
from pathlib import Path

from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_process_init
from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parent


def ensure_backend_on_path() -> None:
    """Keep Agents/backend importable for deferred task imports.

    Celery may rewrite sys.path after app import. Packages already in
    sys.modules (e.g. services) keep working, but first-time imports like
    agents then fail with ModuleNotFoundError.
    """
    root = str(BACKEND_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)
    existing = os.environ.get("PYTHONPATH", "")
    parts = [p for p in existing.split(os.pathsep) if p]
    if root not in parts:
        os.environ["PYTHONPATH"] = (
            root + (os.pathsep + existing if existing else "")
        )


ensure_backend_on_path()

# Ensure Agents/.env is loaded when the worker process starts.
load_dotenv(BACKEND_ROOT / ".env")

try:
    from env_loader import load_agents_env

    load_agents_env()
except Exception:
    pass

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
SOFT_LIMIT = int(os.getenv("CELERY_TASK_SOFT_TIME_LIMIT", "300"))
HARD_LIMIT = int(os.getenv("CELERY_TASK_TIME_LIMIT", "360"))

celery_app = Celery(
    "contos_agents",
    broker=REDIS_URL,
    include=["tasks.profiling", "tasks.translate", "tasks.usage_metering"],
)

# Daily SM OpenRouter activity lands after UTC midnight; run early morning UTC.
_SM_USAGE_CRON_HOUR = int(os.getenv("SUPERMEMORY_USAGE_INGEST_HOUR_UTC", "2"))
_SM_USAGE_CRON_MINUTE = int(os.getenv("SUPERMEMORY_USAGE_INGEST_MINUTE_UTC", "15"))

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    broker_transport_options={
        "visibility_timeout": max(HARD_LIMIT + 60, 420),
    },
    task_soft_time_limit=SOFT_LIMIT,
    task_time_limit=HARD_LIMIT,
    task_default_queue="website",
    task_routes={
        "profiling.run_summarize": {"queue": "website"},
        "profiling.sync_profile": {"queue": "website"},
        "translate.translate_content": {"queue": "website"},
        "usage.ingest_supermemory_openrouter": {"queue": "website"},
    },
    beat_schedule={
        "supermemory-openrouter-usage-daily": {
            "task": "usage.ingest_supermemory_openrouter",
            "schedule": crontab(
                minute=_SM_USAGE_CRON_MINUTE,
                hour=_SM_USAGE_CRON_HOUR,
            ),
            "options": {"queue": "website"},
        },
    },
)

from monitoring import init_glitchtip  # noqa: E402

init_glitchtip()


@worker_process_init.connect
def _rebind_backend_path(**_kwargs: object) -> None:
    ensure_backend_on_path()


app = celery_app
