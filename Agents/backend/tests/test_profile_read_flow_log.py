"""PROFILE_READ ContOS flow logs for Chrome DevTools SSE drain."""

from __future__ import annotations

import logging
from typing import Any
from unittest.mock import patch

import pytest

from services.contos_flow_log import drain_flow_events, flow_context, flow_logs_enabled
from services.profile_context import (
    apply_strategist_profile_context,
    load_strategist_profile_context,
    log_strategist_profile_llm_handoff,
)
from services.supermemory import PROFILE_DOCUMENT_ID, SupermemoryResponse

AVATAR_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
USER_ID = "user-1"
PROFILING = {
    "content_goal": {"question": "Goal?", "answer": "SECRET_ANSWER_LEADS"},
    "brand_voice": {"question": "Voice?", "answer": "SECRET_VOICE"},
}
PROFILE_BODY = "content_goal:\nQ: Goal?\nA: SECRET_ANSWER_LEADS"


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("CONTOS_FLOW_LOGS", "1")
    monkeypatch.setenv("LLM_ENV", "dev")
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")

    def _owned(avatar_id: str, user_id: str) -> dict:
        return {"id": AVATAR_ID, "user_id": USER_ID, "profiling_data": PROFILING}

    with (
        patch("db.supabase_client.assert_avatar_owned", side_effect=_owned),
        patch("services.contos_flow_log._publish_redis_event"),
    ):
        yield


def _lines(events: list[dict[str, Any]]) -> list[str]:
    return [str(e.get("line") or "") for e in events]


def _assert_no_secrets(events: list[dict[str, Any]]) -> None:
    blob = "\n".join(_lines(events))
    assert "SECRET_ANSWER_LEADS" not in blob
    assert "SECRET_VOICE" not in blob
    assert "test-supermemory-key-do-not-leak" not in blob
    assert AVATAR_ID not in blob
    assert "Bearer" not in blob


def test_successful_supermemory_read_emits_full_lifecycle() -> None:
    body = {
        "id": PROFILE_DOCUMENT_ID,
        "content": PROFILE_BODY,
        "system": {"status": "done"},
        "metadata": {"kind": "profile", "source": "contos_profile"},
    }
    with (
        flow_context(user_id=USER_ID, avatar_id=AVATAR_ID),
        patch(
            "services.supermemory.get_document",
            return_value=SupermemoryResponse(
                ok=True,
                operation="get_document",
                status_code=200,
                data=body,
                elapsed_ms=12.5,
            ),
        ),
    ):
        result = load_strategist_profile_context(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            profiling_data=PROFILING,
            agent_type="linkedin",
        )
        profile = apply_strategist_profile_context(
            {
                "avatar_id": AVATAR_ID,
                "profiling_data": PROFILING,
                "profile_summary": "OLD",
            },
            result,
            agent_type="linkedin",
        )
        log_strategist_profile_llm_handoff(
            agent_type="linkedin",
            profile=profile,
            context={
                "brand_profile": profile,
                "avatar_memory": {"voice": [{"content": "x"}]},
                "competitor_intelligence": [{"id": 1}],
            },
        )
        events = drain_flow_events()

    assert result.source == "supermemory"
    joined = "\n".join(_lines(events))
    assert "[CONTOS:PROFILE_READ] Retrieval started" in joined
    assert "agent=linkedin" in joined
    assert "[CONTOS:PROFILE_READ] Supermemory request started" in joined
    assert "document_id=profile" in joined
    assert "[CONTOS:PROFILE_READ] Supermemory request finished" in joined
    assert "status_code=200" in joined
    assert "[CONTOS:PROFILE_READ] Document validation" in joined
    assert "ready=yes" in joined
    assert "processing_status=done" in joined
    assert "[CONTOS:PROFILE_READ] Context source selected" in joined
    assert "source=supermemory" in joined
    assert "[CONTOS:PROFILE_READ] Context injection" in joined
    assert "destination=brand_profile.profile_context" in joined
    assert "profile_summary_cleared=yes" in joined
    assert "[CONTOS:PROFILE_READ] LLM handoff" in joined
    assert "profile_context_present=yes" in joined
    assert "avatar_memory_count=1" in joined
    assert "competitor_present=yes" in joined
    _assert_no_secrets(events)


def test_processing_document_logs_fallback_reason() -> None:
    body = {
        "id": PROFILE_DOCUMENT_ID,
        "content": "indexing…",
        "system": {"status": "embedding"},
    }
    with (
        flow_context(user_id=USER_ID, avatar_id=AVATAR_ID),
        patch(
            "services.supermemory.get_document",
            return_value=SupermemoryResponse(
                ok=True, operation="get_document", status_code=200, data=body
            ),
        ),
    ):
        result = load_strategist_profile_context(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            profiling_data=PROFILING,
            agent_type="instagram",
        )
        events = drain_flow_events()

    assert result.source == "supabase_profiling_data"
    joined = "\n".join(_lines(events))
    assert "ready=no" in joined
    assert "processing_status=embedding" in joined
    assert "source=supabase_raw_fallback" in joined
    assert "reason=processing_incomplete" in joined
    assert "agent=instagram" in joined
    _assert_no_secrets(events)


def test_missing_document_logs_not_found() -> None:
    with (
        flow_context(user_id=USER_ID, avatar_id=AVATAR_ID),
        patch(
            "services.supermemory.get_document",
            return_value=SupermemoryResponse(
                ok=False,
                operation="get_document",
                status_code=404,
                error="http_error",
            ),
        ),
    ):
        result = load_strategist_profile_context(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            profiling_data=PROFILING,
            agent_type="twitter",
        )
        events = drain_flow_events()

    assert result.source == "supabase_profiling_data"
    joined = "\n".join(_lines(events))
    assert "agent=x" in joined
    assert "document_found=no" in joined
    assert "reason=document_not_found" in joined
    assert "source=supabase_raw_fallback" in joined
    _assert_no_secrets(events)


def test_timeout_logs_connection_style_fallback() -> None:
    with (
        flow_context(user_id=USER_ID, avatar_id=AVATAR_ID),
        patch(
            "services.supermemory.get_document",
            return_value=SupermemoryResponse(
                ok=False, operation="get_document", error="timeout"
            ),
        ),
    ):
        result = load_strategist_profile_context(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            profiling_data=PROFILING,
            agent_type="linkedin",
        )
        events = drain_flow_events()

    assert result.source == "supabase_profiling_data"
    joined = "\n".join(_lines(events))
    assert "reason=timeout" in joined
    assert "source=supabase_raw_fallback" in joined
    _assert_no_secrets(events)


def test_injection_and_handoff_reflect_actual_fields() -> None:
    from services.profile_context import ProfileContextResult

    result = ProfileContextResult(
        source="supermemory", content="abc", processing_status="done", status_code=200
    )
    with flow_context(user_id=USER_ID, avatar_id=AVATAR_ID):
        profile = apply_strategist_profile_context(
            {
                "avatar_id": AVATAR_ID,
                "profiling_data": PROFILING,
                "profile_summary": "keep-cleared",
            },
            result,
            agent_type="linkedin",
        )
        assert profile is not None
        assert profile["profile_summary"] is None
        assert profile["profile_context"] == "abc"
        assert "profiling_data" not in profile
        assert profile["profiling_answer_count"] == 2
        log_strategist_profile_llm_handoff(
            agent_type="linkedin",
            profile=profile,
            context={
                "brand_profile": profile,
                "avatar_memory": {},
                "competitor_intelligence": [],
            },
        )
        events = drain_flow_events()

    joined = "\n".join(_lines(events))
    assert "injected=yes" in joined
    assert "profiling_data_omitted=yes" in joined
    assert "brand_profile_tokens=" in joined
    assert "context_tokens=" in joined
    assert "avatar_memory_present=no" in joined
    assert "avatar_memory_count=0" in joined
    assert "competitor_present=no" in joined
    assert "profile_context_chars=3" in joined
    _assert_no_secrets(events)


def test_logging_disabled_emits_no_browser_buffer_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CONTOS_FLOW_LOGS", "0")
    assert flow_logs_enabled() is False
    body = {
        "id": PROFILE_DOCUMENT_ID,
        "content": PROFILE_BODY,
        "system": {"status": "done"},
    }
    with (
        flow_context(user_id=USER_ID, avatar_id=AVATAR_ID),
        patch(
            "services.supermemory.get_document",
            return_value=SupermemoryResponse(
                ok=True, operation="get_document", status_code=200, data=body
            ),
        ),
        patch("services.contos_flow_log._publish_redis_event") as publish,
    ):
        load_strategist_profile_context(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            profiling_data=PROFILING,
            agent_type="linkedin",
        )
        events = drain_flow_events()

    assert events == []
    publish.assert_not_called()


def test_sse_drain_shape_matches_frontend_contos_flow_event() -> None:
    body = {
        "id": PROFILE_DOCUMENT_ID,
        "content": PROFILE_BODY,
        "system": {"status": "done"},
    }
    with (
        flow_context(user_id=USER_ID, avatar_id=AVATAR_ID),
        patch(
            "services.supermemory.get_document",
            return_value=SupermemoryResponse(
                ok=True, operation="get_document", status_code=200, data=body
            ),
        ),
    ):
        load_strategist_profile_context(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            profiling_data=PROFILING,
            agent_type="linkedin",
        )
        events = drain_flow_events()

    assert events
    for event in events:
        assert event["channel"] == "PROFILE_READ"
        assert isinstance(event["line"], str)
        assert event["line"].startswith("[CONTOS:PROFILE_READ]")
        assert "id" in event
        assert event["level"] in {"info", "warn"}
        assert isinstance(event.get("fields"), dict)
    _assert_no_secrets(events)
