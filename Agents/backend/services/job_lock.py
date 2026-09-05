"""Redis distributed locks for Agents Celery website jobs."""

from __future__ import annotations

import logging
import os
import secrets
from collections.abc import Iterator
from contextlib import contextmanager

import redis

logger = logging.getLogger(__name__)

_RELEASE_LOCK_SCRIPT = """
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
"""


def _redis_client() -> redis.Redis:
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    return redis.Redis.from_url(redis_url, decode_responses=True)


def profiling_lock_key(avatar_id: str) -> str:
    return f"profiling:avatar:{avatar_id}"


@contextmanager
def acquire_job_lock(key: str, *, ttl_secs: int) -> Iterator[bool]:
    """Yield True if lock acquired; False if another worker holds it."""
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
