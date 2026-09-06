"""Ephemeral agent-run results in Redis for tab-return catch-up."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import redis

logger = logging.getLogger(__name__)

RUN_RESULT_TTL_SECS = int(os.getenv("AGENTS_RUN_RESULT_TTL_SECS", "3600"))
RUN_KEY_PREFIX = "agents:run:"


class AgentRunStoreError(Exception):
    """Raised when run result persistence or lookup fails."""


def _client() -> redis.Redis:
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    return redis.Redis.from_url(redis_url, decode_responses=True)


def run_key(run_id: str) -> str:
    return f"{RUN_KEY_PREFIX}{run_id}"


def store_run_result(run_id: str, payload: dict[str, Any]) -> None:
    """Persist a finished (or failed) run. Raises AgentRunStoreError on Redis failure."""
    if not run_id or not isinstance(payload, dict):
        raise AgentRunStoreError("run_id and payload dict are required")
    try:
        client = _client()
        client.setex(
            run_key(run_id),
            RUN_RESULT_TTL_SECS,
            json.dumps(payload, default=str),
        )
    except Exception as exc:
        raise AgentRunStoreError(
            f"Failed to store agent run {run_id}: {exc}"
        ) from exc


def get_run_result(run_id: str) -> dict[str, Any] | None:
    """Return stored run payload or None if missing. Raises on Redis errors."""
    if not run_id or not str(run_id).strip():
        raise AgentRunStoreError("run_id is required")
    try:
        client = _client()
        raw = client.get(run_key(str(run_id).strip()))
    except Exception as exc:
        raise AgentRunStoreError(
            f"Failed to load agent run {run_id}: {exc}"
        ) from exc
    if raw is None:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise AgentRunStoreError(
            f"Corrupt agent run payload for {run_id}: {exc}"
        ) from exc
    if not isinstance(parsed, dict):
        raise AgentRunStoreError(
            f"Agent run {run_id} payload must be an object"
        )
    return parsed
