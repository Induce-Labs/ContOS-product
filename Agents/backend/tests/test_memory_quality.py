"""Memory-quality gates: durable preferences kept; session observations rejected."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.avatar_memory import save_memory_updates  # noqa: E402
from services.draft_grounding import (  # noqa: E402
    build_allowed_text,
    filter_memory_updates,
)
from services.supermemory import SupermemoryResponse, memory_document_id  # noqa: E402

AVATAR_ID = "00000000-0000-4000-8000-000000000001"
USER_ID = "user-1"
OWNED = {"id": AVATAR_ID, "user_id": USER_ID}


def _ok_create(document_id: str = "mem_x") -> SupermemoryResponse:
    return SupermemoryResponse(
        ok=True,
        operation="create_document",
        status_code=200,
        data={"id": document_id, "status": "queued"},
        elapsed_ms=5.0,
    )


def test_observed_vague_profiling_observation_is_rejected() -> None:
    allowed = build_allowed_text(
        "tell me what profiling answers i replied vaguely with",
        [],
        [],
    )
    content = (
        "User acknowledged vague answers in profiling; needs concrete metrics "
        "to close authenticity gap"
    )
    filtered = filter_memory_updates(
        [{"kind": "note", "content": content, "source": "inferred"}],
        allowed,
    )
    assert filtered == []

    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch("services.supermemory.create_document") as create,
    ):
        saved = save_memory_updates(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            platform="twitter",
            updates=[{"kind": "note", "content": content, "source": "inferred"}],
        )
    assert saved == []
    create.assert_not_called()


def test_inferred_note_without_durable_evidence_is_rejected() -> None:
    allowed = build_allowed_text("how should we grow on X this month?", [], [])
    filtered = filter_memory_updates(
        [
            {
                "kind": "note",
                "content": "User is exploring growth options for this month",
                "source": "inferred",
            }
        ],
        allowed,
    )
    assert filtered == []


def test_one_time_user_request_does_not_become_memory() -> None:
    allowed = build_allowed_text(
        "write me three LinkedIn posts about our launch for tomorrow",
        [],
        [],
    )
    filtered = filter_memory_updates(
        [
            {
                "kind": "note",
                "content": "Write three LinkedIn posts about the launch for tomorrow",
                "source": "user",
            },
            {
                "kind": "goal",
                "content": "User asked for a one-time LinkedIn launch pack",
                "source": "inferred",
            },
        ],
        allowed,
    )
    assert filtered == []


def test_just_for_this_post_preference_is_rejected() -> None:
    """One-off scoped voice instructions must not become durable memory."""
    allowed = build_allowed_text(
        "Just for this post, use a playful tone once.",
        [],
        [],
    )
    filtered = filter_memory_updates(
        [
            {
                "kind": "voice",
                "content": "Just for this post, use a playful tone once.",
                "source": "user",
            }
        ],
        allowed,
    )
    assert filtered == []


def test_agent_recommendation_is_not_saved_as_user_fact() -> None:
    allowed = build_allowed_text("any tips for hooks?", [], [])
    filtered = filter_memory_updates(
        [
            {
                "kind": "voice",
                "content": "I recommend starting every post with a bold question hook",
                "source": "inferred",
            },
            {
                "kind": "note",
                "content": "Agent recommended question hooks as a user preference",
                "source": "user",
            },
        ],
        allowed,
    )
    assert filtered == []


def test_explicit_user_preference_is_preserved() -> None:
    content = "Prefer short concrete posts with one clear takeaway"
    allowed = build_allowed_text(
        "Please remember: prefer short concrete posts with one clear takeaway.",
        [],
        [],
    )
    filtered = filter_memory_updates(
        [{"kind": "voice", "content": content, "source": "user"}],
        allowed,
    )
    assert len(filtered) == 1
    assert filtered[0]["content"] == content

    expected_id = memory_document_id("voice", content)
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.create_document",
            return_value=_ok_create(expected_id),
        ) as create,
    ):
        saved = save_memory_updates(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            platform="linkedin",
            updates=filtered,
        )
    assert len(saved) == 1
    assert saved[0]["kind"] == "voice"
    assert saved[0]["source"] == "user"
    create.assert_called_once()


def test_explicit_rejection_and_correction_are_preserved() -> None:
    allowed = build_allowed_text(
        "Do not use emoji in posts. Also stop the hype adjectives — no hype adjectives.",
        [{"role": "user", "content": "Correction: keep the tone calm and direct."}],
        [],
    )
    updates = [
        {"kind": "rejection", "content": "No emoji in posts", "source": "user"},
        {
            "kind": "rejection",
            "content": "No hype adjectives",
            "source": "user",
        },
        {
            "kind": "voice",
            "content": "Keep the tone calm and direct",
            "source": "user",
        },
    ]
    filtered = filter_memory_updates(updates, allowed)
    assert {item["kind"] for item in filtered} == {"rejection", "voice"}
    assert len(filtered) == 3

    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.create_document",
            side_effect=lambda *_a, **_k: _ok_create("mem_ok"),
        ) as create,
    ):
        saved = save_memory_updates(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            platform="twitter",
            updates=filtered,
        )
    assert len(saved) == 3
    assert create.call_count == 3


def test_well_supported_inferred_voice_preference_can_be_saved() -> None:
    allowed = build_allowed_text(
        "I like short concrete LinkedIn posts with one takeaway and no hype.",
        [],
        [],
    )
    content = "Prefer short concrete LinkedIn posts with one takeaway"
    filtered = filter_memory_updates(
        [{"kind": "voice", "content": content, "source": "inferred"}],
        allowed,
    )
    assert len(filtered) == 1
    assert filtered[0]["source"] == "inferred"

    expected_id = memory_document_id("voice", content)
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.create_document",
            return_value=_ok_create(expected_id),
        ) as create,
    ):
        saved = save_memory_updates(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            platform="linkedin",
            updates=filtered,
        )
    assert len(saved) == 1
    assert saved[0]["source"] == "inferred"
    create.assert_called_once()


def test_empty_memory_updates_do_not_write() -> None:
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch("services.supermemory.create_document") as create,
    ):
        assert (
            save_memory_updates(
                user_id=USER_ID,
                avatar_id=AVATAR_ID,
                platform="instagram",
                updates=[],
            )
            == []
        )
        assert (
            save_memory_updates(
                user_id=USER_ID,
                avatar_id=AVATAR_ID,
                platform="instagram",
                updates=None,
            )
            == []
        )
    create.assert_not_called()


def test_quote_grounding_still_drops_invented_quotes() -> None:
    allowed = build_allowed_text("keep the tone calm", [], [])
    filtered = filter_memory_updates(
        [
            {
                "kind": "voice",
                "content": 'User said "totally invented customer quote here"',
                "source": "user",
            },
            {
                "kind": "voice",
                "content": "Keep the tone calm",
                "source": "user",
            },
        ],
        allowed,
    )
    assert len(filtered) == 1
    assert filtered[0]["content"] == "Keep the tone calm"


def test_assistant_text_is_not_used_as_evidence() -> None:
    allowed = build_allowed_text(
        "hi",
        [
            {"role": "assistant", "content": "Prefer short concrete posts with one takeaway"},
            {"role": "user", "content": "thanks"},
        ],
        [{"kind": "voice", "content": "Prefer short concrete posts", "source": "inferred"}],
    )
    filtered = filter_memory_updates(
        [
            {
                "kind": "voice",
                "content": "Prefer short concrete posts with one takeaway",
                "source": "inferred",
            }
        ],
        allowed,
    )
    assert filtered == []
