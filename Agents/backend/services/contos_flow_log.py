"""Local-development ContOS profiling/memory flow logs.

Backend terminal: logger ``contos.flow`` with ``[CONTOS:...]`` lines.
Browser DevTools: request-scoped buffer (agent SSE) + Redis list (Celery),
consumed by a gated authenticated endpoint / SSE ``contos_flow`` events.

Enabled by default when ``LLM_ENV`` is not ``prod``. Override with
``CONTOS_FLOW_LOGS=1`` (force on) or ``CONTOS_FLOW_LOGS=0`` (force off).

Never log secrets, prompts, memory content, or profile text.

Buffer/context use ``threading.local`` (not ContextVar) so SSE producer threads
and nested generators still see the same request buffer — ContextVar was
dropping events inside ``agent.run()`` generators, so the browser got
``contos_flow=0``.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterator

logger = logging.getLogger("contos.flow")

_thread_state = threading.local()

_REDIS_KEY_PREFIX = "contos:flow:"
_REDIS_MAX_EVENTS = 100
_REDIS_TTL_SECS = 900
_WARN_TOKENS = (
    "fail",
    "failed",
    "unavailable",
    "retry",
    "deferred",
    "error",
    "skipped",
    "falling back",
)


def flow_logs_enabled() -> bool:
    """Return whether ContOS flow console logs should emit."""
    flag = (os.getenv("CONTOS_FLOW_LOGS") or "").strip().lower()
    if flag in {"0", "false", "no", "off"}:
        return False
    if flag in {"1", "true", "yes", "on"}:
        return True
    env = (os.getenv("LLM_ENV") or "dev").strip().lower()
    return env not in {"prod", "production"}


def short_id(value: object | None, *, keep: int = 8) -> str:
    """Return a truncated non-secret identifier for logs."""
    text = str(value or "").strip()
    if not text:
        return "-"
    if len(text) <= keep:
        return text
    return text[:keep]


@contextmanager
def flow_context(*, user_id: str, avatar_id: str) -> Iterator[None]:
    """Bind user/avatar for Redis publish and start a request event buffer."""
    prev_ctx = getattr(_thread_state, "ctx", None)
    prev_buf = getattr(_thread_state, "buffer", None)
    _thread_state.ctx = {
        "user_id": str(user_id or "").strip(),
        "avatar_id": str(avatar_id or "").strip(),
    }
    _thread_state.buffer = []
    try:
        yield
    finally:
        _thread_state.ctx = prev_ctx
        _thread_state.buffer = prev_buf


def drain_flow_events() -> list[dict[str, Any]]:
    """Return and clear buffered in-request flow events (SSE drain)."""
    buf = getattr(_thread_state, "buffer", None)
    if not isinstance(buf, list) or not buf:
        return []
    events = list(buf)
    buf.clear()
    return events


def flow_log(channel: str, message: str, **fields: Any) -> None:
    """Emit one structured ContOS flow event when enabled."""
    if not flow_logs_enabled():
        return
    try:
        level = "warn" if _is_warn(message, fields) else "info"
        safe_fields = _safe_fields(fields)
        line = _format_line(channel, message, safe_fields)
        # Always print so Agents terminal shows lines even if logging is filtered.
        print(line, flush=True)
        if level == "warn":
            logger.warning("%s", line)
        else:
            logger.info("%s", line)

        event = {
            "id": uuid.uuid4().hex,
            "channel": str(channel),
            "message": str(message),
            "level": level,
            "fields": safe_fields,
            "line": line,
            "ts": round(time.time(), 3),
        }
        buf = getattr(_thread_state, "buffer", None)
        if isinstance(buf, list):
            buf.append(event)
        _publish_redis_event(event)
    except Exception:
        # Observability must never break profiling or agent responses.
        logger.debug("contos flow_log emission failed", exc_info=True)


def consume_flow_events(*, user_id: str, avatar_id: str) -> list[dict[str, Any]]:
    """Pop buffered Redis flow events for an owned avatar (browser poll)."""
    if not flow_logs_enabled():
        return []
    uid = str(user_id or "").strip()
    aid = str(avatar_id or "").strip()
    if not uid or not aid:
        return []
    try:
        client = _redis_client()
        key = _redis_key(uid, aid)
        pipe = client.pipeline()
        pipe.lrange(key, 0, -1)
        pipe.delete(key)
        rows, _deleted = pipe.execute()
    except Exception:
        logger.debug("contos flow redis consume failed", exc_info=True)
        return []
    events: list[dict[str, Any]] = []
    for raw in reversed(rows or []):
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict) and payload.get("line"):
            events.append(payload)
    return events


def _format_line(channel: str, message: str, fields: dict[str, Any]) -> str:
    parts = [f"[CONTOS:{channel}] {message}"]
    for key, value in fields.items():
        parts.append(f"{key}={value}")
    return " | ".join(parts)


def _is_warn(message: str, fields: dict[str, Any]) -> bool:
    hay = f"{message} {' '.join(str(v) for v in fields.values())}".lower()
    return any(token in hay for token in _WARN_TOKENS)


def _safe_fields(fields: dict[str, Any]) -> dict[str, Any]:
    blocked = {
        "authorization",
        "api_key",
        "token",
        "content",
        "summary",
        "query",
        "prompt",
        "body",
        "memory",
        "password",
        "secret",
    }
    safe: dict[str, Any] = {}
    for key, value in fields.items():
        if value is None:
            continue
        key_l = str(key).strip().lower()
        # Block secret-like keys. Allow observability counts such as
        # brand_profile_tokens / context_tokens (must not match bare "token").
        if key_l in blocked:
            continue
        if any(part in key_l for part in ("secret", "password")):
            continue
        if key_l == "token" or key_l.endswith("_token") or key_l.endswith("_key"):
            continue
        if isinstance(value, bool):
            safe[str(key)] = value
        elif isinstance(value, (int, float)):
            safe[str(key)] = value
        else:
            text = str(value).strip()
            if not text:
                continue
            safe[str(key)] = text[:120]
    return safe


def _redis_key(user_id: str, avatar_id: str) -> str:
    return f"{_REDIS_KEY_PREFIX}{user_id}:{avatar_id}"


def _redis_client() -> Any:
    import redis

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    return redis.Redis.from_url(redis_url, decode_responses=True)


def _publish_redis_event(event: dict[str, Any]) -> None:
    ctx = getattr(_thread_state, "ctx", None)
    if not isinstance(ctx, dict):
        return
    user_id = ctx.get("user_id") or ""
    avatar_id = ctx.get("avatar_id") or ""
    if not user_id or not avatar_id:
        return
    try:
        client = _redis_client()
        key = _redis_key(user_id, avatar_id)
        payload = json.dumps(event, default=str, separators=(",", ":"))
        pipe = client.pipeline()
        pipe.lpush(key, payload)
        pipe.ltrim(key, 0, _REDIS_MAX_EVENTS - 1)
        pipe.expire(key, _REDIS_TTL_SECS)
        pipe.execute()
    except Exception:
        logger.debug("contos flow redis publish failed", exc_info=True)
