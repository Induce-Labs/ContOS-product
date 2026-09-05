"""Redis connectivity check for Agents health endpoints."""

from __future__ import annotations

import logging
import os

import redis

logger = logging.getLogger(__name__)


def ping_redis() -> bool:
    """Return True if Redis responds to PING."""
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    try:
        client = redis.Redis.from_url(redis_url, decode_responses=True)
        return client.ping() is True
    except Exception as error:
        logger.warning("Redis health ping failed", extra={"error": str(error)})
        return False
