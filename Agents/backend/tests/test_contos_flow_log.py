"""Unit tests for ContOS local flow logging helpers."""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.contos_flow_log import (  # noqa: E402
    drain_flow_events,
    flow_context,
    flow_log,
    flow_logs_enabled,
    short_id,
)


def test_short_id_truncates_safely() -> None:
    assert short_id("abcdef0123456789") == "abcdef01"
    assert short_id("") == "-"
    assert short_id(None) == "-"


def test_flow_logs_respect_explicit_off(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("CONTOS_FLOW_LOGS", "0")
    monkeypatch.setenv("LLM_ENV", "dev")
    assert flow_logs_enabled() is False


def test_flow_logs_default_on_in_dev(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("CONTOS_FLOW_LOGS", raising=False)
    monkeypatch.setenv("LLM_ENV", "dev")
    assert flow_logs_enabled() is True


def test_flow_logs_default_off_in_prod(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.delenv("CONTOS_FLOW_LOGS", raising=False)
    monkeypatch.setenv("LLM_ENV", "prod")
    assert flow_logs_enabled() is False


def test_flow_log_emits_prefixed_line(monkeypatch, caplog) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("CONTOS_FLOW_LOGS", "1")
    with (
        patch("services.contos_flow_log._publish_redis_event"),
        caplog.at_level(logging.INFO, logger="contos.flow"),
    ):
        flow_log("MEMORY_READ", "Started", source="Supermemory", mode="hybrid")
    assert any("[CONTOS:MEMORY_READ] Started" in record.message for record in caplog.records)
    assert any("source=Supermemory" in record.message for record in caplog.records)


def test_flow_context_buffers_events_for_sse_drain(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("CONTOS_FLOW_LOGS", "1")
    with (
        patch("services.contos_flow_log._publish_redis_event") as publish,
        flow_context(user_id="user-1", avatar_id="avatar-1"),
    ):
        flow_log("MEMORY_WRITE", "Started", agent="linkedin", proposed=1)
        events = drain_flow_events()
    assert len(events) == 1
    assert events[0]["channel"] == "MEMORY_WRITE"
    assert events[0]["line"].startswith("[CONTOS:MEMORY_WRITE] Started")
    assert publish.called
    assert drain_flow_events() == []


def test_flow_buffer_survives_nested_generator_in_thread(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """SSE producer runs agent.run() generators on a worker thread."""
    import threading

    monkeypatch.setenv("CONTOS_FLOW_LOGS", "1")
    collected: list[dict] = []

    def _produce() -> None:
        def _inner_gen():
            flow_log("PROFILE_READ", "Retrieval started", source="Supermemory")
            yield from drain_flow_events()

        def _outer_gen():
            yield from _inner_gen()

        with (
            patch("services.contos_flow_log._publish_redis_event"),
            flow_context(user_id="user-1", avatar_id="avatar-1"),
        ):
            for evt in _outer_gen():
                collected.append(evt)

    worker = threading.Thread(target=_produce)
    worker.start()
    worker.join(timeout=5)
    assert len(collected) == 1
    assert collected[0]["channel"] == "PROFILE_READ"
    assert "Supermemory" in collected[0]["line"]


def test_flow_log_never_raises_on_redis_failure(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("CONTOS_FLOW_LOGS", "1")

    def _boom(_event: object) -> None:
        raise RuntimeError("redis down")

    with (
        patch("services.contos_flow_log._publish_redis_event", side_effect=_boom),
        flow_context(user_id="user-1", avatar_id="avatar-1"),
    ):
        flow_log("PROFILING", "Started", avatar="abc12345")


def test_consume_flow_events_returns_empty_when_disabled(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from services.contos_flow_log import consume_flow_events

    monkeypatch.setenv("CONTOS_FLOW_LOGS", "0")
    with patch("services.contos_flow_log._redis_client") as client:
        assert consume_flow_events(user_id="u", avatar_id="a") == []
        client.assert_not_called()
