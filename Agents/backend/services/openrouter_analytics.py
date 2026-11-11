"""OpenRouter Management API helpers for Supermemory usage metering."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

OPENROUTER_API_BASE = "https://openrouter.ai/api/v1"
MAX_ATTEMPTS = 3
RETRY_BACKOFF_SECS = (1.0, 2.0, 4.0)


class OpenRouterAnalyticsError(RuntimeError):
    """OpenRouter Management/Analytics API failure with actionable detail."""


@dataclass(frozen=True)
class OpenRouterActivityRow:
    date: str
    model: str
    prompt_tokens: int
    completion_tokens: int
    requests: int
    usage_usd: float
    endpoint_id: str | None = None


def _management_key() -> str:
    key = (os.getenv("OPENROUTER_MANAGEMENT_KEY") or "").strip()
    if not key:
        raise OpenRouterAnalyticsError(
            "OPENROUTER_MANAGEMENT_KEY is not set. Add an OpenRouter management key "
            "on contos-agents / contos-agents-worker."
        )
    return key


def _request_json(
    method: str,
    path: str,
    *,
    query: dict[str, str] | None = None,
) -> Any:
    key = _management_key()
    url = f"{OPENROUTER_API_BASE}{path}"
    if query:
        url = f"{url}?{urlencode(query)}"
    headers = {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "User-Agent": "contos-agents-usage-meter/1.0",
    }
    last_error: Exception | None = None
    for attempt in range(MAX_ATTEMPTS):
        request = Request(url, method=method, headers=headers)
        try:
            with urlopen(request, timeout=60) as response:
                body = response.read().decode("utf-8", "replace")
                status = getattr(response, "status", 200)
                if status >= 400:
                    raise OpenRouterAnalyticsError(
                        f"OpenRouter {method} {path} failed status={status} body={body[:500]}"
                    )
                if not body.strip():
                    return {}
                return json.loads(body)
        except HTTPError as exc:
            err_body = exc.read().decode("utf-8", "replace") if exc.fp else ""
            last_error = OpenRouterAnalyticsError(
                f"OpenRouter {method} {path} HTTPError status={exc.code} "
                f"reason={exc.reason!r} body={err_body[:500]}"
            )
            if exc.code in {429, 500, 502, 503, 504} and attempt < MAX_ATTEMPTS - 1:
                logger.warning(
                    "openrouter analytics retry path=%s status=%s attempt=%s",
                    path,
                    exc.code,
                    attempt + 1,
                )
                time.sleep(RETRY_BACKOFF_SECS[attempt])
                continue
            raise last_error from exc
        except URLError as exc:
            last_error = OpenRouterAnalyticsError(
                f"OpenRouter {method} {path} URLError reason={exc.reason!r}"
            )
            if attempt < MAX_ATTEMPTS - 1:
                logger.warning(
                    "openrouter analytics network retry path=%s attempt=%s",
                    path,
                    attempt + 1,
                )
                time.sleep(RETRY_BACKOFF_SECS[attempt])
                continue
            raise last_error from exc
        except OpenRouterAnalyticsError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise OpenRouterAnalyticsError(
                f"OpenRouter {method} {path} failed: {exc}"
            ) from exc
    assert last_error is not None
    raise last_error


def list_api_keys(*, include_disabled: bool = False) -> list[dict[str, Any]]:
    payload = _request_json(
        "GET",
        "/keys",
        query={"include_disabled": "true" if include_disabled else "false"},
    )
    rows = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        raise OpenRouterAnalyticsError(
            f"OpenRouter /keys returned unexpected payload type={type(payload).__name__}"
        )
    return [row for row in rows if isinstance(row, dict)]


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def resolve_supermemory_api_key_hash() -> tuple[str, str | None]:
    """Return (hash, label) for the SM-only OpenRouter inference key."""
    explicit = (os.getenv("SUPERMEMORY_OPENROUTER_API_KEY_HASH") or "").strip().lower()
    env_label = (
        os.getenv("SUPERMEMORY_OPENROUTER_KEY_LABEL")
        or os.getenv("SUPERMEMORY_OPENROUTER_KEY_NAME")
        or ""
    ).strip() or None
    keys = list_api_keys()
    name_hint = (env_label or "supermemory").strip().lower()

    if explicit:
        for row in keys:
            if str(row.get("hash") or "").strip().lower() == explicit:
                label = str(row.get("name") or row.get("label") or "").strip() or env_label
                return explicit, label
        return explicit, env_label

    named: list[dict[str, Any]] = []
    for row in keys:
        label = str(row.get("name") or row.get("label") or "").strip()
        if name_hint and name_hint in label.lower():
            named.append(row)
    if len(named) == 1:
        key_hash = str(named[0].get("hash") or "").strip().lower()
        if not key_hash:
            raise OpenRouterAnalyticsError(
                "Matched OpenRouter key is missing hash field."
            )
        label = str(named[0].get("name") or named[0].get("label") or "") or None
        return key_hash, label

    agents_key = (os.getenv("OPENROUTER_API_KEY") or "").strip()
    agents_hash = sha256_hex(agents_key) if agents_key else ""
    candidates = [
        row
        for row in keys
        if str(row.get("hash") or "").strip().lower()
        and str(row.get("hash") or "").strip().lower() != agents_hash
        and not bool(row.get("disabled"))
    ]
    if len(candidates) == 1:
        key_hash = str(candidates[0].get("hash") or "").strip().lower()
        label = str(candidates[0].get("name") or candidates[0].get("label") or "") or None
        return key_hash, label

    raise OpenRouterAnalyticsError(
        "Could not resolve SUPERMEMORY_OPENROUTER_API_KEY_HASH. Set it explicitly, "
        f"or set SUPERMEMORY_OPENROUTER_KEY_NAME (tried hint={name_hint!r}); "
        f"keys_visible={len(keys)} named_matches={len(named)} "
        f"non_agents_candidates={len(candidates)}."
    )


def _normalize_activity_date(raw: Any) -> str:
    """OpenRouter returns ``YYYY-MM-DD`` or ``YYYY-MM-DD 00:00:00``."""
    text = str(raw or "").strip()
    if not text:
        return ""
    return text[:10]


def fetch_activity_for_date(
    *,
    usage_date: str,
    api_key_hash: str,
) -> list[OpenRouterActivityRow]:
    # Prefer key-scoped activity. OpenRouter's ``date`` query is unreliable
    # with ``YYYY-MM-DD`` when rows are stored as ``YYYY-MM-DD 00:00:00``, so
    # filter the last-30-day window client-side by calendar day.
    payload = _request_json(
        "GET",
        "/activity",
        query={"api_key_hash": api_key_hash},
    )
    rows = payload.get("data") if isinstance(payload, dict) else payload
    if rows is None:
        return []
    if not isinstance(rows, list):
        raise OpenRouterAnalyticsError(
            f"OpenRouter /activity returned unexpected payload type={type(payload).__name__}"
        )

    out: list[OpenRouterActivityRow] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        day = _normalize_activity_date(row.get("date"))
        if day != usage_date:
            continue
        model = str(row.get("model") or "").strip()
        if not model:
            continue
        out.append(
            OpenRouterActivityRow(
                date=day,
                model=model,
                prompt_tokens=int(row.get("prompt_tokens") or 0),
                completion_tokens=int(row.get("completion_tokens") or 0),
                requests=int(row.get("requests") or 0),
                usage_usd=float(row.get("usage") or 0.0),
                endpoint_id=(
                    str(row["endpoint_id"])
                    if row.get("endpoint_id") is not None
                    else None
                ),
            )
        )
    return out


def is_embedding_model(model: str) -> bool:
    lowered = model.lower()
    return "embedding" in lowered or lowered.endswith(":embed")
