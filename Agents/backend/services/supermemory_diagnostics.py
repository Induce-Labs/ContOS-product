"""Temporary Supermemory connectivity probe. Remove after verification."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_TIMEOUT_SECS = 20.0


def probe_supermemory() -> dict[str, Any]:
    """GET {SUPERMEMORY_BASE_URL}/v3/projects. Never includes the API key."""
    base_url = (os.getenv("SUPERMEMORY_BASE_URL") or "").strip().rstrip("/")
    api_key = (os.getenv("SUPERMEMORY_API_KEY") or "").strip()

    if not base_url:
        return _result(False, None, "SUPERMEMORY_BASE_URL is not set.")
    if not api_key:
        return _result(False, None, "SUPERMEMORY_API_KEY is not set.")

    url = f"{base_url}/v3/projects"
    try:
        with httpx.Client(timeout=_TIMEOUT_SECS, follow_redirects=False) as client:
            response = client.get(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
            )
    except httpx.TimeoutException:
        logger.warning(
            "supermemory diagnostic timed out",
            extra={"timeout_secs": _TIMEOUT_SECS},
        )
        return _result(False, None, "Supermemory request timed out.")
    except httpx.ConnectError:
        logger.warning("supermemory diagnostic connection failed")
        return _result(False, None, "Supermemory connection failed.")
    except httpx.HTTPError:
        logger.warning("supermemory diagnostic request failed")
        return _result(False, None, "Supermemory request failed.")

    status_code = response.status_code
    if 200 <= status_code < 300:
        logger.info(
            "supermemory diagnostic succeeded",
            extra={"status_code": status_code},
        )
        return _result(True, status_code, None)

    logger.warning(
        "supermemory diagnostic returned non-success status",
        extra={"status_code": status_code},
    )
    return _result(False, status_code, f"Supermemory returned HTTP {status_code}.")


def _result(connected: bool, status_code: int | None, error: str | None) -> dict[str, Any]:
    return {
        "connected": connected,
        "status_code": status_code,
        "error": error,
    }
