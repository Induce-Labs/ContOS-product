"""Redis admission control for Agents chat invoke (minute/day/inflight).

Inflight key is a shared SET of server-generated tokens for ``{user_id, scope}``.
Redis EXPIRE applies to the entire SET (not per token). Active streams must call
``refresh_inflight_ttl`` about every 30s so the shared key stays alive. If the
safety TTL elapses with no refresh, the whole SET is deleted and ownership is lost.
"""

from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import redis

logger = logging.getLogger(__name__)

LimitType = Literal["minute", "day", "concurrent", "redis"]

DEFAULT_SCOPE = "global"
DEFAULT_PER_MINUTE = 15
DEFAULT_PER_DAY = 150
DEFAULT_MAX_INFLIGHT = 1
DEFAULT_INFLIGHT_TTL_SECS = 900
MINUTE_KEY_TTL_SECS = 120
DAY_KEY_TTL_SECS = 172_800
INFLIGHT_REFRESH_INTERVAL_SECS = 30

# KEYS[1]=minute KEYS[2]=day KEYS[3]=inflight
# ARGV: max_minute, max_day, max_inflight, token, minute_ttl, day_ttl, inflight_ttl,
#       minute_retry_after, day_retry_after
_ADMIT_SCRIPT = """
local minute_key = KEYS[1]
local day_key = KEYS[2]
local inflight_key = KEYS[3]
local max_minute = tonumber(ARGV[1])
local max_day = tonumber(ARGV[2])
local max_inflight = tonumber(ARGV[3])
local token = ARGV[4]
local minute_ttl = tonumber(ARGV[5])
local day_ttl = tonumber(ARGV[6])
local inflight_ttl = tonumber(ARGV[7])
local minute_retry = tonumber(ARGV[8])
local day_retry = tonumber(ARGV[9])

local inflight_count = redis.call("SCARD", inflight_key)
if inflight_count >= max_inflight then
  return {"concurrent"}
end

local minute_raw = redis.call("GET", minute_key)
local minute_count = tonumber(minute_raw) or 0
if minute_count >= max_minute then
  return {"minute", minute_retry}
end

local day_raw = redis.call("GET", day_key)
local day_count = tonumber(day_raw) or 0
if day_count >= max_day then
  return {"day", day_retry}
end

local new_minute = redis.call("INCR", minute_key)
if new_minute == 1 then
  redis.call("EXPIRE", minute_key, minute_ttl)
end

local new_day = redis.call("INCR", day_key)
if new_day == 1 then
  redis.call("EXPIRE", day_key, day_ttl)
end

redis.call("SADD", inflight_key, token)
redis.call("EXPIRE", inflight_key, inflight_ttl)
return {"ok", token}
"""

_RELEASE_SCRIPT = """
local inflight_key = KEYS[1]
local token = ARGV[1]
local removed = redis.call("SREM", inflight_key, token)
if removed == 0 then
  return 0
end
if redis.call("SCARD", inflight_key) == 0 then
  redis.call("DEL", inflight_key)
end
return 1
"""

_REFRESH_SCRIPT = """
local inflight_key = KEYS[1]
local token = ARGV[1]
local inflight_ttl = tonumber(ARGV[2])
if redis.call("SISMEMBER", inflight_key, token) == 1 then
  redis.call("EXPIRE", inflight_key, inflight_ttl)
  return 1
end
return 0
"""


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    limit_type: LimitType | None
    retry_after_seconds: int | None
    message: str


class RateLimitConfigError(ValueError):
    """Raised when rate-limit env configuration is invalid."""


def _redis_client() -> redis.Redis:
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    return redis.Redis.from_url(redis_url, decode_responses=True)


def _positive_int(name: str, raw: str | None, default: int) -> int:
    value = default if raw is None or str(raw).strip() == "" else int(str(raw).strip())
    if value < 1:
        raise RateLimitConfigError(f"{name} must be a positive integer, got {value}")
    return value


def load_rate_limit_config() -> dict[str, int]:
    """Load and validate rate-limit env vars. Raises RateLimitConfigError if invalid."""
    try:
        return {
            "per_minute": _positive_int(
                "AGENTS_RATE_LIMIT_PER_MINUTE",
                os.getenv("AGENTS_RATE_LIMIT_PER_MINUTE"),
                DEFAULT_PER_MINUTE,
            ),
            "per_day": _positive_int(
                "AGENTS_RATE_LIMIT_PER_DAY",
                os.getenv("AGENTS_RATE_LIMIT_PER_DAY"),
                DEFAULT_PER_DAY,
            ),
            "max_inflight": _positive_int(
                "AGENTS_MAX_INFLIGHT_PER_USER",
                os.getenv("AGENTS_MAX_INFLIGHT_PER_USER"),
                DEFAULT_MAX_INFLIGHT,
            ),
            "inflight_ttl_secs": _positive_int(
                "AGENTS_INFLIGHT_TTL_SECS",
                os.getenv("AGENTS_INFLIGHT_TTL_SECS"),
                DEFAULT_INFLIGHT_TTL_SECS,
            ),
        }
    except ValueError as exc:
        if isinstance(exc, RateLimitConfigError):
            raise
        raise RateLimitConfigError(
            f"Invalid rate-limit configuration: {exc}"
        ) from exc


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def minute_window_id(now: datetime | None = None) -> str:
    current = now or _utc_now()
    return current.strftime("%Y%m%d%H%M")


def day_window_id(now: datetime | None = None) -> str:
    current = now or _utc_now()
    return current.strftime("%Y%m%d")


def seconds_until_minute_end(now: datetime | None = None) -> int:
    current = now or _utc_now()
    remaining = 60 - current.second
    if remaining <= 0:
        return 1
    return remaining


def seconds_until_day_end(now: datetime | None = None) -> int:
    current = now or _utc_now()
    midnight = datetime(
        year=current.year,
        month=current.month,
        day=current.day,
        tzinfo=timezone.utc,
    ).replace(hour=0, minute=0, second=0, microsecond=0)
    next_midnight = midnight + timedelta(days=1)
    remaining = int((next_midnight - current).total_seconds())
    return max(1, remaining)


def minute_key(user_id: str, scope: str, window: str | None = None) -> str:
    return f"agents:rl:{user_id}:{scope}:m:{window or minute_window_id()}"


def day_key(user_id: str, scope: str, window: str | None = None) -> str:
    return f"agents:rl:{user_id}:{scope}:d:{window or day_window_id()}"


def inflight_key(user_id: str, scope: str) -> str:
    return f"agents:rl:{user_id}:{scope}:inflight"


def _denied(
    *,
    limit_type: LimitType,
    message: str,
    retry_after_seconds: int | None = None,
) -> RateLimitResult:
    return RateLimitResult(
        allowed=False,
        limit_type=limit_type,
        retry_after_seconds=retry_after_seconds,
        message=message,
    )


def _parse_admit_result(raw: Any) -> tuple[RateLimitResult, str | None]:
    if not isinstance(raw, (list, tuple)) or not raw:
        raise ValueError(f"Unexpected admit script result: {raw!r}")

    status = str(raw[0])
    if status == "ok":
        if len(raw) < 2 or not raw[1]:
            raise ValueError(f"Admit ok missing token: {raw!r}")
        return (
            RateLimitResult(
                allowed=True,
                limit_type=None,
                retry_after_seconds=None,
                message="",
            ),
            str(raw[1]),
        )
    if status == "concurrent":
        return (
            _denied(
                limit_type="concurrent",
                message=(
                    "You already have an active agent stream. "
                    "Please wait for it to finish."
                ),
            ),
            None,
        )
    if status == "minute":
        retry = int(raw[1]) if len(raw) > 1 else 1
        return (
            _denied(
                limit_type="minute",
                retry_after_seconds=max(1, retry),
                message="Too many messages this minute — try again shortly.",
            ),
            None,
        )
    if status == "day":
        retry = int(raw[1]) if len(raw) > 1 else 1
        return (
            _denied(
                limit_type="day",
                retry_after_seconds=max(1, retry),
                message="Daily message limit reached — try again tomorrow (UTC).",
            ),
            None,
        )
    raise ValueError(f"Unexpected admit status: {raw!r}")


def admit_chat_request(
    user_id: str,
    *,
    scope: str = DEFAULT_SCOPE,
    redis_client: redis.Redis | None = None,
    now: datetime | None = None,
) -> tuple[RateLimitResult, str | None]:
    """Atomically admit a chat invoke or return a denial. Token is server-generated."""
    if not user_id or not str(user_id).strip():
        return (
            _denied(
                limit_type="redis",
                message=(
                    "Agent chat is temporarily unavailable. Please try again shortly."
                ),
            ),
            None,
        )

    uid = str(user_id).strip()
    scope_value = scope if scope else DEFAULT_SCOPE

    try:
        config = load_rate_limit_config()
    except RateLimitConfigError as exc:
        logger.error(
            "agents_rate_limit_redis_error",
            extra={
                "event": "agents_rate_limit_redis_error",
                "user_id": uid,
                "scope": scope_value,
                "limit_type": "redis",
                "retry_after_seconds": None,
                "error": str(exc),
            },
        )
        return (
            _denied(
                limit_type="redis",
                message=(
                    "Agent chat is temporarily unavailable. Please try again shortly."
                ),
            ),
            None,
        )

    current = now or _utc_now()
    token = secrets.token_urlsafe(16)
    m_key = minute_key(uid, scope_value, minute_window_id(current))
    d_key = day_key(uid, scope_value, day_window_id(current))
    i_key = inflight_key(uid, scope_value)
    minute_retry = seconds_until_minute_end(current)
    day_retry = seconds_until_day_end(current)

    try:
        client = redis_client or _redis_client()
        raw = client.eval(
            _ADMIT_SCRIPT,
            3,
            m_key,
            d_key,
            i_key,
            config["per_minute"],
            config["per_day"],
            config["max_inflight"],
            token,
            MINUTE_KEY_TTL_SECS,
            DAY_KEY_TTL_SECS,
            config["inflight_ttl_secs"],
            minute_retry,
            day_retry,
        )
        result, admitted_token = _parse_admit_result(raw)
    except Exception as error:
        logger.error(
            "agents_rate_limit_redis_error",
            extra={
                "event": "agents_rate_limit_redis_error",
                "user_id": uid,
                "scope": scope_value,
                "limit_type": "redis",
                "retry_after_seconds": None,
                "error": str(error),
            },
        )
        return (
            _denied(
                limit_type="redis",
                message=(
                    "Agent chat is temporarily unavailable. Please try again shortly."
                ),
            ),
            None,
        )

    if not result.allowed:
        event = (
            "agents_concurrent_limit_rejected"
            if result.limit_type == "concurrent"
            else "agents_rate_limit_rejected"
        )
        logger.info(
            event,
            extra={
                "event": event,
                "user_id": uid,
                "scope": scope_value,
                "limit_type": result.limit_type,
                "retry_after_seconds": result.retry_after_seconds,
            },
        )
        return result, None

    return result, admitted_token


def release_inflight(
    user_id: str,
    token: str,
    *,
    scope: str = DEFAULT_SCOPE,
    redis_client: redis.Redis | None = None,
) -> None:
    """Release the caller's inflight token. Never raises for Redis/cleanup failures."""
    if not user_id or not token:
        return
    uid = str(user_id).strip()
    scope_value = scope if scope else DEFAULT_SCOPE
    try:
        client = redis_client or _redis_client()
        client.eval(_RELEASE_SCRIPT, 1, inflight_key(uid, scope_value), token)
    except Exception as error:
        logger.warning(
            "agents_rate_limit_release_error",
            extra={
                "event": "agents_rate_limit_release_error",
                "user_id": uid,
                "scope": scope_value,
                "limit_type": None,
                "retry_after_seconds": None,
                "error": str(error),
            },
        )


def clear_inflight(
    user_id: str,
    *,
    scope: str = DEFAULT_SCOPE,
    redis_client: redis.Redis | None = None,
) -> None:
    """Delete the whole inflight SET for a user/scope (preempt zombie streams)."""
    if not user_id:
        return
    uid = str(user_id).strip()
    scope_value = scope if scope else DEFAULT_SCOPE
    try:
        client = redis_client or _redis_client()
        client.delete(inflight_key(uid, scope_value))
    except Exception as error:
        logger.warning(
            "agents_rate_limit_clear_error",
            extra={
                "event": "agents_rate_limit_clear_error",
                "user_id": uid,
                "scope": scope_value,
                "limit_type": None,
                "retry_after_seconds": None,
                "error": str(error),
            },
        )


def refresh_inflight_ttl(
    user_id: str,
    token: str,
    *,
    scope: str = DEFAULT_SCOPE,
    redis_client: redis.Redis | None = None,
) -> bool:
    """Refresh shared inflight SET TTL if token is still a member. Never raises."""
    if not user_id or not token:
        return False
    uid = str(user_id).strip()
    scope_value = scope if scope else DEFAULT_SCOPE
    try:
        config = load_rate_limit_config()
        client = redis_client or _redis_client()
        raw = client.eval(
            _REFRESH_SCRIPT,
            1,
            inflight_key(uid, scope_value),
            token,
            config["inflight_ttl_secs"],
        )
        return int(raw or 0) == 1
    except Exception as error:
        logger.warning(
            "agents_rate_limit_refresh_error",
            extra={
                "event": "agents_rate_limit_refresh_error",
                "user_id": uid,
                "scope": scope_value,
                "limit_type": None,
                "retry_after_seconds": None,
                "error": str(error),
            },
        )
        return False


def rate_limit_http_exception(result: RateLimitResult) -> Any:
    """Build FastAPI HTTPException for a denied RateLimitResult."""
    from fastapi import HTTPException

    if result.limit_type == "redis":
        return HTTPException(
            status_code=503,
            detail={
                "error": "rate_limit_unavailable",
                "message": result.message,
            },
        )

    if result.limit_type == "concurrent":
        return HTTPException(
            status_code=429,
            detail={
                "error": "concurrent_limit",
                "message": result.message,
            },
        )

    headers: dict[str, str] = {}
    detail: dict[str, Any] = {
        "error": "rate_limit",
        "message": result.message,
    }
    if result.retry_after_seconds is not None:
        detail["retry_after_seconds"] = result.retry_after_seconds
        headers["Retry-After"] = str(result.retry_after_seconds)
    return HTTPException(status_code=429, detail=detail, headers=headers or None)
