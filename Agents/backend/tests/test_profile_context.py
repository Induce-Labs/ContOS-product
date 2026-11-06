"""Strategist PROFILE_READ: Supermemory primary, raw profiling_data fallback."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.profile_context import (
    apply_strategist_profile_context,
    format_profiling_data_fallback,
    load_strategist_profile_context,
)
from services.supermemory import PROFILE_DOCUMENT_ID, SupermemoryResponse

AVATAR_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
USER_ID = "user-1"
PROFILING = {
    "content_goal": {"question": "Goal?", "answer": "Leads"},
    "brand_voice": {"question": "Voice?", "answer": "Direct"},
}


@pytest.fixture(autouse=True)
def _owned_avatar(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")

    def _owned(avatar_id: str, user_id: str) -> dict:
        assert avatar_id == AVATAR_ID
        assert user_id == USER_ID
        return {"id": AVATAR_ID, "user_id": USER_ID, "profiling_data": PROFILING}

    with patch("db.supabase_client.assert_avatar_owned", side_effect=_owned):
        yield


def test_format_profiling_data_fallback_renders_compact_bullets() -> None:
    text = format_profiling_data_fallback(PROFILING)
    assert text is not None
    assert "Compact profile" in text
    assert "- brand_voice: Direct" in text
    assert "- content_goal: Leads" in text
    assert "Q: Goal?" not in text


def test_load_profile_from_supermemory_when_ready() -> None:
    body = {
        "id": PROFILE_DOCUMENT_ID,
        "content": "content_goal:\nQ: Goal?\nA: Leads",
        "system": {"status": "done"},
        "metadata": {"kind": "profile", "source": "contos_profile"},
    }
    with patch(
        "services.supermemory.get_document",
        return_value=SupermemoryResponse(
            ok=True, operation="get_document", status_code=200, data=body
        ),
    ) as get_doc:
        result = load_strategist_profile_context(
            user_id=USER_ID, avatar_id=AVATAR_ID, profiling_data=PROFILING
        )

    get_doc.assert_called_once_with(f"avatar_{AVATAR_ID}", PROFILE_DOCUMENT_ID)
    assert result.source == "supermemory"
    assert result.content and "Leads" in result.content
    assert result.error is None


def test_processing_document_falls_back_to_raw_profiling() -> None:
    body = {
        "id": PROFILE_DOCUMENT_ID,
        "content": "stale while indexing",
        "system": {"status": "embedding"},
    }
    with patch(
        "services.supermemory.get_document",
        return_value=SupermemoryResponse(
            ok=True, operation="get_document", status_code=200, data=body
        ),
    ):
        result = load_strategist_profile_context(
            user_id=USER_ID, avatar_id=AVATAR_ID, profiling_data=PROFILING
        )

    assert result.source == "supabase_profiling_data"
    assert result.error == "processing"
    assert result.content and "Leads" in result.content


def test_missing_document_falls_back() -> None:
    with patch(
        "services.supermemory.get_document",
        return_value=SupermemoryResponse(
            ok=False, operation="get_document", status_code=404, error="http_error"
        ),
    ):
        result = load_strategist_profile_context(
            user_id=USER_ID, avatar_id=AVATAR_ID, profiling_data=PROFILING
        )

    assert result.source == "supabase_profiling_data"
    assert result.error == "http_error"


def test_empty_content_is_not_successful_retrieval() -> None:
    body = {"id": PROFILE_DOCUMENT_ID, "content": "   ", "system": {"status": "done"}}
    with patch(
        "services.supermemory.get_document",
        return_value=SupermemoryResponse(
            ok=True, operation="get_document", status_code=200, data=body
        ),
    ):
        result = load_strategist_profile_context(
            user_id=USER_ID, avatar_id=AVATAR_ID, profiling_data=PROFILING
        )

    assert result.source == "supabase_profiling_data"
    assert result.error == "empty_or_unusable"


def test_timeout_falls_back_without_raising() -> None:
    with patch(
        "services.supermemory.get_document",
        return_value=SupermemoryResponse(
            ok=False, operation="get_document", error="timeout"
        ),
    ):
        result = load_strategist_profile_context(
            user_id=USER_ID, avatar_id=AVATAR_ID, profiling_data=PROFILING
        )

    assert result.source == "supabase_profiling_data"
    assert result.error == "timeout"


def test_connection_failed_falls_back() -> None:
    with patch(
        "services.supermemory.get_document",
        return_value=SupermemoryResponse(
            ok=False, operation="get_document", error="connection_failed"
        ),
    ):
        result = load_strategist_profile_context(
            user_id=USER_ID, avatar_id=AVATAR_ID, profiling_data=PROFILING
        )

    assert result.source == "supabase_profiling_data"
    assert result.error == "connection_failed"


def test_apply_injects_profile_context_and_clears_summary() -> None:
    from services.profile_context import ProfileContextResult

    profile = {
        "profiling_data": PROFILING,
        "profile_summary": "## Old LLM summary",
        "name": "Acme",
        "website_summary": "Site blurb",
    }
    result = ProfileContextResult(
        source="supermemory",
        content="from supermemory",
    )
    updated = apply_strategist_profile_context(profile, result)
    assert updated is not None
    assert updated["profile_context"] == "from supermemory"
    assert updated["profile_context_source"] == "supermemory"
    assert updated["profile_summary"] is None
    assert "profiling_data" not in updated
    assert updated["profiling_answer_count"] == 2
    assert updated["website_summary"] == "Site blurb"
    assert "avatar_memory" not in updated


def test_apply_omits_website_when_embedded_in_supermemory_context() -> None:
    from services.profile_context import ProfileContextResult

    profile = {
        "profiling_data": PROFILING,
        "website_summary": "Duplicate site text",
        "website_summary_status": "completed",
        "website_summary_url": "https://example.com",
        "name": "Acme",
    }
    result = ProfileContextResult(
        source="supermemory",
        content="voice:\nQ: Voice?\nA: Direct\n\nwebsite_summary:\nSite from SM",
    )
    updated = apply_strategist_profile_context(profile, result)
    assert updated is not None
    assert "profiling_data" not in updated
    assert "website_summary" not in updated
    assert "website_summary_status" not in updated
    assert "website_summary_url" not in updated
    assert "website_summary:" in (updated["profile_context"] or "")


def test_apply_fallback_omits_raw_profiling_data() -> None:
    from services.profile_context import ProfileContextResult

    profile = {"profiling_data": PROFILING, "name": "Acme", "brand_voice": "Direct"}
    result = ProfileContextResult(
        source="supabase_profiling_data",
        content="Compact profile (Supermemory unavailable):\n- brand_voice: Direct",
        error="http_error",
    )
    updated = apply_strategist_profile_context(profile, result)
    assert updated is not None
    assert "profiling_data" not in updated
    assert updated["profiling_answer_count"] == 2
    assert updated["brand_voice"] == "Direct"


def test_draft_judge_skips_profiling_answers_when_profile_context_present() -> None:
    from services.draft_judge import build_facts

    facts = build_facts(
        "Write a post",
        None,
        None,
        {
            "brand_voice": "Direct",
            "profile_context": "Compact or SM context",
            "profiling_data": PROFILING,
        },
    )
    assert facts["profiling_answers"] == []
    assert facts["profile_summary"] == "Compact or SM context"

    facts_raw = build_facts(
        "Write a post",
        None,
        None,
        {"profiling_data": PROFILING},
    )
    assert len(facts_raw["profiling_answers"]) == 2


def test_maybe_refresh_stale_is_noop() -> None:
    from services.profile_summary import maybe_refresh_stale_profile_summary

    with patch(
        "services.profile_summary.generate_and_store_profile_summary"
    ) as generate:
        out = maybe_refresh_stale_profile_summary(
            {
                "id": AVATAR_ID,
                "profiling_data": PROFILING,
                "profile_summary_status": "pending",
            },
            USER_ID,
        )
    assert out is None
    generate.assert_not_called()


def test_generate_does_not_call_summary_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.profile_summary import generate_and_store_profile_summary

    row = {
        "id": AVATAR_ID,
        "user_id": USER_ID,
        "profiling_data": PROFILING,
        "profile_summary_status": "pending",
        "profile_summary": None,
    }
    updates: list[dict] = []

    def _update(**kwargs):
        updates.append(kwargs)
        return {**row, **kwargs}

    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=row),
        patch("db.supabase_client.update_avatar_profile_summary", side_effect=_update),
        patch(
            "services.profile_summary.generate_and_store_website_summary",
            return_value={
                "website_summary": None,
                "status": "skipped",
                "url": None,
                "cached": True,
            },
        ),
        patch("services.enqueue_profile_sync.schedule_profile_sync", return_value=True),
        patch("services.profile_summary.build_profile_summary_prompt") as prompt,
    ):
        # Ensure no LLM path: if anything imported get_llm_client it would fail.
        result = generate_and_store_profile_summary(
            avatar_id=AVATAR_ID, user_id=USER_ID, force=True, schedule_sync=True
        )

    prompt.assert_not_called()
    assert result["status"] == "completed"
    assert result["cached"] is False
    assert result["profile_sync_enqueued"] is True
    assert any(u.get("status") == "completed" and "summary" not in u for u in updates)
