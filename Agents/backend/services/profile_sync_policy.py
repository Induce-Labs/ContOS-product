"""Retry bounds for avatar profile synchronization.

This module has no Celery or Supermemory I/O. Tasks and the publish-failure
recovery path share it so both use the same attempt limit and delay.
"""

from __future__ import annotations

import os


def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return int(raw)


PROFILE_SYNC_MAX_RETRIES = _int_env("PROFILE_SYNC_MAX_RETRIES", 3)
PROFILE_SYNC_RETRY_BACKOFF_SECS = _int_env("PROFILE_SYNC_RETRY_BACKOFF_SECS", 15)
PROFILE_SYNC_RETRY_AFTER_MAX_SECS = 120
PROFILE_SYNC_PUBLISH_ATTEMPTS = 3
PROFILE_SYNC_PUBLISH_BACKOFF_SECS = 0.2

_PERMANENT_HTTP_STATUSES = frozenset({400, 401, 402, 403, 405, 406, 410, 422, 451})


def profile_sync_is_retryable(error: str | None, status_code: int | None = None) -> bool:
    """Return whether this sync failure should be retried.

    Timeouts, connection failures, HTTP 408, 409, 429, and 5xx responses
    except 501 are transient. A final write response of 404 is also retried.
    The expected GET 404, meaning the profile document does not exist yet, is
    handled before this function and creates the document. Authentication,
    authorization, and validation statuses are permanent. A missing status
    code is not retried.
    """
    if error in {"timeout", "connection_failed", "lock_held", "lock_unavailable"}:
        return True
    if error != "http_error" or status_code is None:
        return False
    if status_code in _PERMANENT_HTTP_STATUSES or status_code == 501:
        return False
    return status_code in {404, 408, 409, 429} or status_code >= 500


def profile_sync_retry_delay(
    attempt: int,
    retry_after_seconds: int | None = None,
) -> int:
    """Return the backoff in seconds before the next sync attempt.

    ``attempt`` is the zero-based attempt that just failed. The delay doubles
    on each attempt. A Retry-After value extends the delay up to
    ``PROFILE_SYNC_RETRY_AFTER_MAX_SECS``.
    """
    if attempt < 0:
        raise ValueError(f"profile sync retry attempt must be >= 0, got {attempt}")
    delay = PROFILE_SYNC_RETRY_BACKOFF_SECS * (2**attempt)
    if retry_after_seconds is None or retry_after_seconds <= delay:
        return delay
    return min(retry_after_seconds, PROFILE_SYNC_RETRY_AFTER_MAX_SECS)
