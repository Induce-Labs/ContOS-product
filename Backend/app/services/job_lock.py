"""Redis distributed locks for Celery scrape jobs."""

from __future__ import annotations

import logging
import secrets
from contextlib import contextmanager
from collections.abc import Iterator

import redis

from app.config import get_settings
from app.errors import ConfigurationError

logger = logging.getLogger(__name__)

_RELEASE_LOCK_SCRIPT = """
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
"""


def _redis_client() -> redis.Redis:
    settings = get_settings()
    if not settings.redis_url:
        raise ConfigurationError("REDIS_URL is required for Celery job locks.")
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)


def competitor_lock_key(competitor_id: str) -> str:
    return f"pipeline:competitor:{competitor_id}"


@contextmanager
def acquire_job_lock(key: str, *, ttl_secs: int) -> Iterator[bool]:
    """Yield True if lock acquired; False if another worker holds it. Always releases on exit."""
    client = _redis_client()
    token = secrets.token_hex(16)
    acquired = bool(client.set(key, token, nx=True, ex=max(1, ttl_secs)))
    if not acquired:
        logger.info("Job lock not acquired", extra={"lock_key": key})
        yield False
        return
    try:
        yield True
    finally:
        try:
            client.eval(_RELEASE_LOCK_SCRIPT, 1, key, token)
        except Exception as error:
            logger.warning(
                "Failed to release job lock",
                extra={"lock_key": key, "error": str(error)},
            )
