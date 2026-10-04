"""GlitchTip error monitoring via the Sentry-compatible Python SDK.

The DSN is a GlitchTip project DSN supplied by ``SENTRY_DSN``. No Sentry
hosted account and no auth token are used. When the DSN is unset, init is a
no-op and the process still starts.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import sentry_sdk
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.logging import LoggingIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

_IGNORED_STATUS = frozenset({400, 401, 403, 404, 409, 410, 429})
_FAILED_STATUS = frozenset({500, 502, 503, 504})
_SENSITIVE_QUERY = frozenset(
    {
        "access_token",
        "refresh_token",
        "client_secret",
        "api_key",
        "token",
        "secret",
        "password",
        "code",
    }
)
_DROP_KEYS = _SENSITIVE_QUERY | frozenset(
    {
        "authorization",
        "cookie",
        "set-cookie",
        "contos_provision_secret",
        "postiz_token_encryption_key",
        "public_key",
    }
)
_FILTERED = "[Filtered]"

# Positional arg names that are safe to tag. Anything else on the task stays off the event.
_TASK_SAFE_ARGS: dict[str, tuple[str, ...]] = {
    "profiling.run_summarize": ("avatar_id", "user_id"),
}

_BEARER = re.compile(r"Bearer\s+\S+", re.IGNORECASE)
_POS_TOKEN = re.compile(r"\bpos_[A-Za-z0-9_\-]+")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b")
_ASSIGNMENT = re.compile(
    r"(?i)\b(access_token|refresh_token|client_secret|api_key|token|password|secret|"
    r"CONTOS_PROVISION_SECRET|POSTIZ_TOKEN_ENCRYPTION_KEY)\b(\s*[=:]\s*)([^\s&\"']+)"
)
_DATASTORE_URL = re.compile(
    r"\b(?:redis|rediss|postgres|postgresql|mysql|mongodb(?:\+srv)?)://\S+",
    re.IGNORECASE,
)
_CREDENTIAL_URL = re.compile(
    r"\b[a-z][a-z0-9+.-]*://[^\s/@]+:[^\s/@]+@[^\s]+",
    re.IGNORECASE,
)
_PUBLIC_DSN = re.compile(r"\bhttps?://[a-f0-9]{32}@", re.IGNORECASE)
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_initialized = False


def init_glitchtip(dsn: str | None = None, environment: str | None = None) -> None:
    """Initialize GlitchTip when a DSN is set. Idempotent.

    Explicit arguments win. Otherwise the process environment is used, which is
    how production injects ``SENTRY_DSN``. An empty DSN leaves monitoring off.
    """
    global _initialized
    resolved_dsn = dsn if dsn is not None else os.getenv("SENTRY_DSN", "")
    resolved_dsn = resolved_dsn.strip()
    if not resolved_dsn or _initialized:
        return
    resolved_environment = (
        environment if environment is not None else os.getenv("SENTRY_ENVIRONMENT", "")
    )
    resolved_environment = resolved_environment.strip()
    sentry_sdk.init(
        dsn=resolved_dsn,
        environment=resolved_environment or None,
        traces_sample_rate=0.01,
        auto_session_tracking=False,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        before_send=before_send,
        before_send_transaction=before_send,
        before_breadcrumb=before_breadcrumb,
        integrations=[
            StarletteIntegration(failed_request_status_codes=set(_FAILED_STATUS)),
            FastApiIntegration(failed_request_status_codes=set(_FAILED_STATUS)),
            CeleryIntegration(),
            LoggingIntegration(level=None, event_level=None, sentry_logs_level=None),
        ],
    )
    _initialized = True


def capture_server_exception(error: BaseException) -> None:
    """Report an unexpected server failure. No-op when monitoring is not configured."""
    if not os.getenv("SENTRY_DSN", "").strip():
        return
    sentry_sdk.capture_exception(error)


def before_send(event: dict[str, Any], hint: dict[str, Any] | None = None) -> dict[str, Any] | None:
    status_code = _status_code(event, hint)
    if status_code in _IGNORED_STATUS:
        return None
    _apply_safe_task_tags(event)
    _strip_request_secrets(event)
    _strip_celery_payloads(event)
    return _redact_event(event)


def before_breadcrumb(crumb: dict[str, Any], hint: dict[str, Any] | None = None) -> dict[str, Any] | None:
    del hint
    data = crumb.get("data")
    if isinstance(data, dict):
        for key in list(data):
            if str(key).lower() in {
                "headers",
                "cookies",
                "body",
                "data",
                "request_body",
                "response_body",
                "authorization",
                "cookie",
                "set-cookie",
            }:
                data.pop(key, None)
        url = data.get("url")
        if isinstance(url, str):
            data["url"] = scrub_url(url)
    message = crumb.get("message")
    if isinstance(message, str):
        crumb["message"] = redact_text(message)
    return crumb


def redact_text(value: str) -> str:
    text = _CREDENTIAL_URL.sub(_FILTERED, value)
    text = _PUBLIC_DSN.sub("https://[Filtered]@", text)
    text = _DATASTORE_URL.sub(_FILTERED, text)
    text = _BEARER.sub(f"Bearer {_FILTERED}", text)
    text = _POS_TOKEN.sub(_FILTERED, text)
    text = _JWT.sub(_FILTERED, text)
    text = _ASSIGNMENT.sub(lambda match: f"{match.group(1)}{match.group(2)}{_FILTERED}", text)
    return text


def scrub_url(url: str) -> str:
    try:
        parts = urlsplit(url)
    except ValueError:
        return redact_text(url)
    query = parts.query
    if query:
        pairs: list[tuple[str, str]] = []
        for key, item in parse_qsl(query, keep_blank_values=True):
            if key.lower() in _SENSITIVE_QUERY:
                pairs.append((key, _FILTERED))
            else:
                pairs.append((key, item))
        query = urlencode(pairs)
    scrubbed = urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))
    return redact_text(scrubbed)


def _status_code(event: dict[str, Any], hint: dict[str, Any] | None) -> int | None:
    if hint:
        exc_info = hint.get("exc_info")
        if isinstance(exc_info, tuple) and len(exc_info) >= 2:
            code = getattr(exc_info[1], "status_code", None)
            if isinstance(code, int):
                return code
    contexts = event.get("contexts")
    if isinstance(contexts, dict):
        response = contexts.get("response")
        if isinstance(response, dict):
            code = response.get("status_code")
            if isinstance(code, int):
                return code
    tags = event.get("tags")
    if isinstance(tags, dict):
        raw = tags.get("http.status_code")
        if isinstance(raw, int):
            return raw
        if isinstance(raw, str) and raw.isdigit():
            return int(raw)
    return None


def _apply_safe_task_tags(event: dict[str, Any]) -> None:
    tags = event.get("tags")
    if not isinstance(tags, dict):
        tags = {}
        event["tags"] = tags
    for job in _celery_jobs(event):
        task_name = job.get("task") or job.get("task_name") or tags.get("celery_task_name")
        names = _TASK_SAFE_ARGS.get(task_name) if isinstance(task_name, str) else None
        args = job.get("args")
        if names and isinstance(args, (list, tuple)):
            for name, value in zip(names, args, strict=False):
                if _is_safe_id(value):
                    tags[name] = value
        kwargs = job.get("kwargs")
        if isinstance(kwargs, dict):
            for key in ("user_id", "avatar_id", "competitor_id"):
                value = kwargs.get(key)
                if _is_safe_id(value):
                    tags[key] = value
        retries = job.get("retries")
        if isinstance(retries, int):
            tags["retry_count"] = str(retries)


def _strip_celery_payloads(event: dict[str, Any]) -> None:
    for job in _celery_jobs(event):
        job.pop("args", None)
        job.pop("kwargs", None)


def _celery_jobs(event: dict[str, Any]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for container_name in ("contexts", "extra"):
        container = event.get(container_name)
        if not isinstance(container, dict):
            continue
        for key, value in container.items():
            if not isinstance(value, dict):
                continue
            key_name = str(key).lower()
            if "celery" not in key_name and "args" not in value and "kwargs" not in value:
                continue
            if "celery" in key_name or "args" in value or "kwargs" in value:
                if "celery" in key_name or "task" in value or "task_name" in value:
                    found.append(value)
    return found


def _strip_request_secrets(event: dict[str, Any]) -> None:
    request = event.get("request")
    if not isinstance(request, dict):
        return
    for key in ("headers", "cookies", "data", "env", "body"):
        request.pop(key, None)
    url = request.get("url")
    if isinstance(url, str):
        request["url"] = scrub_url(url)
    query = request.get("query_string")
    if isinstance(query, str):
        request["query_string"] = scrub_url(f"http://scrub.local/?{query}").split("?", 1)[-1]
    elif isinstance(query, dict):
        request["query_string"] = {
            key: (_FILTERED if str(key).lower() in _SENSITIVE_QUERY else item)
            for key, item in query.items()
        }


def _redact_event(event: dict[str, Any]) -> dict[str, Any]:
    redacted = _redact_value(event)
    if isinstance(redacted, dict):
        return redacted
    return event


def _redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, list):
        return [_redact_value(item) for item in value]
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            if str(key).lower() in _DROP_KEYS:
                continue
            cleaned[str(key)] = _redact_value(item)
        return cleaned
    if isinstance(value, Mapping):
        return _redact_value(dict(value))
    return value


def _is_safe_id(value: object) -> bool:
    if not isinstance(value, str) or not _SAFE_ID.fullmatch(value):
        return False
    lowered = value.lower()
    if lowered.startswith("pos_") or "secret" in lowered or "token" in lowered or "bearer" in lowered:
        return False
    return True
