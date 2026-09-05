"""Redis connectivity check for Backend health endpoints."""

from __future__ import annotations

import logging

import redis

from app.config import get_settings

logger = logging.getLogger(__name__)


def ping_redis() -> bool:
    """Return True if Redis responds to PING."""
    settings = get_settings()
    try:
        client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
        return client.ping() is True
    except Exception as error:
        logger.warning("Redis health ping failed", extra={"error": str(error)})
        return False
