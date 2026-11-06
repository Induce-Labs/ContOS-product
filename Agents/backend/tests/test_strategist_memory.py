"""Unit tests for Supermemory-first strategist memory retrieval."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.avatar_memory import (  # noqa: E402
    MEMORY_KINDS,
    STRATEGIST_MEMORY_ORIGIN,
    STRATEGIST_MEMORY_QUERY_MAX_CHARS,
    STRATEGIST_MEMORY_SEARCH_FILTER,
    load_strategist_memory,
)
from services.supermemory import SupermemoryResponse  # noqa: E402

AVATAR_ID = "00000000-0000-4000-8000-000000000001"
USER_ID = "user-1"
OWNED = {"id": AVATAR_ID, "user_id": USER_ID}


def _hit(
    *,
    memory_id: str = "mem_abc",
    memory: str | None = "Prefer short posts",
    chunk: str | None = None,
    kind: str = "voice",
    source: str = "user",
    platform: str | None = "linkedin",
    origin: str | None = None,
    updated_at: str = "2026-11-02T00:00:00Z",
) -> dict[str, Any]:
    metadata: dict[str, Any] = {"kind": kind, "source": source}
    if platform is not None:
        metadata["platform"] = platform
    if origin is not None:
        metadata["origin"] = origin
    hit: dict[str, Any] = {
        "id": memory_id,
        "metadata": metadata,
        "similarity": 0.9,
        "isLatest": True,
        "isInference": False,
        "system": {"updatedAt": updated_at, "createdAt": "2026-11-01T00:00:00Z"},
    }
    if memory is not None:
        hit["memory"] = memory
    if chunk is not None:
        hit["chunk"] = chunk
    return hit


def _ok(results: list[Any]) -> SupermemoryResponse:
    return SupermemoryResponse(
        ok=True,
        operation="search_memories",
        status_code=200,
        data={"results": results, "searchTime": 12},
        elapsed_ms=12.0,
    )


def test_valid_results_map_and_preserve_rejection() -> None:
    supabase_rows = [{"id": "legacy", "kind": "note", "content": "legacy"}]
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.search_memories",
            return_value=_ok(
                [
                    _hit(memory_id="mem_1", memory="Keep tone calm", kind="voice"),
                    _hit(
                        memory_id="mem_2",
                        memory="No emoji",
                        kind="rejection",
                        source="user",
                    ),
                ]
            ),
        ) as search,
        patch(
            "services.avatar_memory.load_avatar_memory",
            return_value=supabase_rows,
        ) as supabase,
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input="Write a LinkedIn post",
        )

    assert [row["id"] for row in rows] == ["mem_1", "mem_2"]
    assert rows[0]["kind"] == "voice"
    assert rows[0]["content"] == "Keep tone calm"
    assert rows[0]["source"] == "user"
    assert rows[0]["platform"] == "linkedin"
    assert rows[0]["created_at"] == "2026-11-02T00:00:00Z"
    assert rows[1]["kind"] == "rejection"
    assert rows[1]["content"] == "No emoji"
    search.assert_called_once()
    assert search.call_args.args[0] == f"avatar_{AVATAR_ID}"
    assert search.call_args.kwargs["search_mode"] == "hybrid"
    assert search.call_args.kwargs["filter"] == {
        "operator": "eq",
        "field": "origin",
        "value": "contos_avatar_memory",
    }
    assert search.call_args.kwargs["filter"] == STRATEGIST_MEMORY_SEARCH_FILTER
    supabase.assert_not_called()


def test_strategist_search_sends_exact_origin_filter() -> None:
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch("services.supermemory.search_memories", return_value=_ok([])) as search,
        patch("services.avatar_memory.load_avatar_memory") as supabase,
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input="retrieve preferences",
        )

    assert rows == []
    search.assert_called_once()
    assert search.call_args.kwargs["limit"] == 8
    assert search.call_args.kwargs["threshold"] == 0.4
    assert search.call_args.kwargs["search_mode"] == "hybrid"
    assert search.call_args.kwargs["filter"] == {
        "operator": "eq",
        "field": "origin",
        "value": STRATEGIST_MEMORY_ORIGIN,
    }
    supabase.assert_not_called()


@pytest.mark.parametrize("kind", list(MEMORY_KINDS))
def test_supported_memory_kinds_remain_retrievable(kind: str) -> None:
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.search_memories",
            return_value=_ok(
                [
                    _hit(
                        memory_id=f"mem_{kind}",
                        memory=f"Durable {kind} preference",
                        kind=kind,
                        source="user",
                        origin=STRATEGIST_MEMORY_ORIGIN,
                    )
                ]
            ),
        ) as search,
        patch("services.avatar_memory.load_avatar_memory") as supabase,
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input=f"need {kind}",
        )

    assert len(rows) == 1
    assert rows[0]["kind"] == kind
    assert rows[0]["content"] == f"Durable {kind} preference"
    assert search.call_args.kwargs["filter"]["value"] == STRATEGIST_MEMORY_ORIGIN
    supabase.assert_not_called()


def test_server_side_origin_filter_excludes_profile_before_mapping() -> None:
    """Filter is applied on the request; leftover profile hits still drop client-side."""
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.search_memories",
            return_value=_ok(
                [
                    _hit(
                        memory_id="profile_leak",
                        memory="Should not reach the LLM as avatar_memory",
                        kind="profile",
                        source="contos_profile",
                    ),
                    _hit(
                        memory_id="mem_note",
                        memory="Keep competitor claims specific",
                        kind="note",
                        source="inferred",
                        origin=STRATEGIST_MEMORY_ORIGIN,
                    ),
                ]
            ),
        ) as search,
        patch("services.avatar_memory.load_avatar_memory") as supabase,
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input="competitors",
        )

    assert search.call_args.kwargs["filter"] == STRATEGIST_MEMORY_SEARCH_FILTER
    assert [row["id"] for row in rows] == ["mem_note"]
    assert all(row["kind"] != "profile" for row in rows)
    supabase.assert_not_called()


def test_chunk_only_hit_maps_correctly() -> None:
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.search_memories",
            return_value=_ok(
                [
                    _hit(
                        memory_id="chunk_1",
                        memory=None,
                        chunk="Prefer short, concrete LinkedIn posts",
                        kind="voice",
                        source="user",
                        platform="linkedin",
                        origin="contos_avatar_memory",
                    )
                ]
            ),
        ),
        patch("services.avatar_memory.load_avatar_memory") as supabase,
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input="LinkedIn voice",
        )

    assert len(rows) == 1
    assert rows[0]["id"] == "chunk_1"
    assert rows[0]["kind"] == "voice"
    assert rows[0]["content"] == "Prefer short, concrete LinkedIn posts"
    assert rows[0]["source"] == "user"
    assert rows[0]["platform"] == "linkedin"
    supabase.assert_not_called()


def test_profile_kind_origin_and_source_hits_are_skipped() -> None:
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.search_memories",
            return_value=_ok(
                [
                    _hit(
                        memory_id="mem_profile",
                        memory="Full brand profile summary text",
                        kind="profile",
                        source="user",
                        platform=None,
                    ),
                    _hit(
                        memory_id="chunk_profile",
                        memory=None,
                        chunk="Profile chunk text",
                        kind="profile",
                        source="user",
                        platform=None,
                    ),
                    _hit(
                        memory_id="mem_origin_profile",
                        memory="Synced profile body",
                        kind="note",
                        source="user",
                        platform=None,
                        origin="contos_profile",
                    ),
                    _hit(
                        memory_id="chunk_origin_profile",
                        memory=None,
                        chunk="Synced profile chunk",
                        kind="voice",
                        source="user",
                        origin="contos_profile",
                    ),
                    _hit(
                        memory_id="mem_source_profile",
                        memory="Profile-derived with non-profile kind",
                        kind="voice",
                        source="contos_profile",
                        platform=None,
                    ),
                    _hit(
                        memory_id="chunk_source_profile",
                        memory=None,
                        chunk="Profile-derived chunk with note kind",
                        kind="note",
                        source="contos_profile",
                        platform=None,
                    ),
                    _hit(
                        memory_id="mem_voice",
                        memory="Keep posts short",
                        kind="voice",
                        source="user",
                    ),
                ]
            ),
        ),
        patch("services.avatar_memory.load_avatar_memory") as supabase,
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input="brand voice",
        )

    assert len(rows) == 1
    assert rows[0]["id"] == "mem_voice"
    assert rows[0]["kind"] == "voice"
    assert rows[0]["content"] == "Keep posts short"
    assert all(row["kind"] != "profile" for row in rows)
    assert all(row["id"] != "mem_profile" for row in rows)
    assert all(row["id"] != "chunk_profile" for row in rows)
    assert all(row["id"] != "mem_origin_profile" for row in rows)
    assert all(row["id"] != "chunk_origin_profile" for row in rows)
    assert all(row["id"] != "mem_source_profile" for row in rows)
    assert all(row["id"] != "chunk_source_profile" for row in rows)
    supabase.assert_not_called()


@pytest.mark.parametrize(
    ("marker_hit", "keeper_id"),
    [
        (
            _hit(
                memory_id="skip_kind",
                memory="Brand audience: founders in SaaS",
                kind="profile",
                source="user",
                platform=None,
            ),
            "keeper",
        ),
        (
            _hit(
                memory_id="skip_origin",
                memory="Brand audience: founders in SaaS",
                kind="note",
                source="user",
                platform=None,
                origin="contos_profile",
            ),
            "keeper",
        ),
        (
            _hit(
                memory_id="skip_source",
                memory="Brand audience: founders in SaaS",
                kind="voice",
                source="contos_profile",
                platform=None,
            ),
            "keeper",
        ),
    ],
)
def test_each_profile_exclusion_marker_alone_is_enough(
    marker_hit: dict[str, Any],
    keeper_id: str,
) -> None:
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.search_memories",
            return_value=_ok(
                [
                    marker_hit,
                    _hit(
                        memory_id=keeper_id,
                        memory="Use plain language and one takeaway",
                        kind="voice",
                        source="user",
                    ),
                ]
            ),
        ),
        patch("services.avatar_memory.load_avatar_memory") as supabase,
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input="audience voice",
        )

    assert len(rows) == 1
    assert rows[0]["id"] == keeper_id
    assert rows[0]["kind"] == "voice"
    assert all(row["id"] != marker_hit["id"] for row in rows)
    supabase.assert_not_called()


def test_hybrid_memory_and_chunk_duplicates_keep_highest_ranked() -> None:
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.search_memories",
            return_value=_ok(
                [
                    _hit(
                        memory_id="mem_first",
                        memory="Prefer short posts",
                        kind="voice",
                    ),
                    _hit(
                        memory_id="chunk_dup",
                        memory=None,
                        chunk="Prefer short posts",
                        kind="voice",
                    ),
                    _hit(
                        memory_id="mem_other",
                        memory="No hype adjectives",
                        kind="rejection",
                    ),
                ]
            ),
        ),
        patch("services.avatar_memory.load_avatar_memory") as supabase,
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input="tone",
        )

    assert [row["id"] for row in rows] == ["mem_first", "mem_other"]
    assert rows[0]["kind"] == "voice"
    assert rows[1]["kind"] == "rejection"
    supabase.assert_not_called()


def test_prefers_memory_text_when_both_memory_and_chunk_present() -> None:
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.search_memories",
            return_value=_ok(
                [
                    {
                        "id": "both",
                        "memory": "From memory field",
                        "chunk": "From chunk field",
                        "metadata": {
                            "kind": "voice",
                            "source": "user",
                            "platform": "linkedin",
                        },
                        "system": {"updatedAt": "2026-11-02T00:00:00Z"},
                    }
                ]
            ),
        ),
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input="tone",
        )

    assert len(rows) == 1
    assert rows[0]["content"] == "From memory field"


def test_missing_metadata_uses_safe_defaults_and_skips_blank_text() -> None:
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.search_memories",
            return_value=_ok(
                [
                    {
                        "id": "mem_ok",
                        "memory": "  Useful fact  ",
                        "metadata": {"kind": "unknown", "source": "weird", "platform": "tiktok"},
                        "system": {},
                    },
                    {"id": "mem_blank", "memory": "   "},
                    {"id": "chunk_blank", "chunk": "   ", "memory": ""},
                    {"id": "empty_hit"},
                    "not-a-dict",
                ]
            ),
        ),
        patch("services.avatar_memory.load_avatar_memory") as supabase,
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input="tone",
        )

    assert len(rows) == 1
    assert rows[0]["id"] == "mem_ok"
    assert rows[0]["kind"] == "note"
    assert rows[0]["source"] == "inferred"
    assert rows[0]["platform"] is None
    assert rows[0]["created_at"] is None
    assert rows[0]["content"] == "Useful fact"
    supabase.assert_not_called()


def test_successful_empty_search_does_not_call_supabase() -> None:
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch("services.supermemory.search_memories", return_value=_ok([])) as search,
        patch("services.avatar_memory.load_avatar_memory") as supabase,
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input="anything",
        )

    assert rows == []
    assert search.call_args.kwargs["filter"] == STRATEGIST_MEMORY_SEARCH_FILTER
    supabase.assert_not_called()


@pytest.mark.parametrize(
    "response",
    [
        SupermemoryResponse(
            ok=False,
            operation="search_memories",
            error="missing_configuration",
        ),
        SupermemoryResponse(
            ok=False,
            operation="search_memories",
            error="timeout",
        ),
        SupermemoryResponse(
            ok=False,
            operation="search_memories",
            status_code=500,
            error="http_error",
        ),
        SupermemoryResponse(
            ok=True,
            operation="search_memories",
            status_code=200,
            data={"searchTime": 1},
        ),
        SupermemoryResponse(
            ok=True,
            operation="search_memories",
            status_code=200,
            data={"results": "bad"},
        ),
    ],
)
def test_failures_and_invalid_success_fall_back_to_supabase(
    response: SupermemoryResponse,
) -> None:
    fallback = [{"id": "sb-1", "kind": "goal", "content": "From Supabase"}]
    configured = response.error != "missing_configuration"
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch(
            "services.supermemory.is_supermemory_configured",
            return_value=configured,
        ),
        patch("services.supermemory.search_memories", return_value=response) as search,
        patch(
            "services.avatar_memory.load_avatar_memory",
            return_value=fallback,
        ) as supabase,
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input="fallback path",
        )

    assert rows == fallback
    if configured:
        search.assert_called_once()
    else:
        search.assert_not_called()
    supabase.assert_called_once_with(
        user_id=USER_ID,
        avatar_id=AVATAR_ID,
        purpose="supermemory_fallback",
    )


def test_query_is_capped_and_search_called_once() -> None:
    long_input = "x" * (STRATEGIST_MEMORY_QUERY_MAX_CHARS + 40)
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch("services.supermemory.search_memories", return_value=_ok([])) as search,
        patch("services.avatar_memory.load_avatar_memory") as supabase,
    ):
        load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input=long_input,
        )

    assert search.call_count == 1
    assert search.call_args.args[1] == "x" * STRATEGIST_MEMORY_QUERY_MAX_CHARS
    assert search.call_args.kwargs["limit"] == 8
    assert search.call_args.kwargs["threshold"] == 0.4
    assert search.call_args.kwargs["search_mode"] == "hybrid"
    assert search.call_args.kwargs["filter"] == STRATEGIST_MEMORY_SEARCH_FILTER
    supabase.assert_not_called()


def test_namespace_uses_owned_avatar_id_not_request_argument() -> None:
    owned = {"id": AVATAR_ID, "user_id": USER_ID}
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=owned) as owned_check,
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch("services.supermemory.search_memories", return_value=_ok([])) as search,
    ):
        load_strategist_memory(
            user_id=USER_ID,
            avatar_id="client-supplied-id",
            user_input="query",
        )

    owned_check.assert_called_once_with("client-supplied-id", USER_ID)
    assert search.call_args.args[0] == f"avatar_{AVATAR_ID}"


def test_results_are_capped_at_eight() -> None:
    hits = [
        _hit(memory_id=f"mem_{index}", memory=f"Fact {index}")
        for index in range(12)
    ]
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch("services.supermemory.search_memories", return_value=_ok(hits)),
    ):
        rows = load_strategist_memory(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            user_input="many",
        )

    assert len(rows) == 8
    assert rows[0]["id"] == "mem_0"
    assert rows[-1]["id"] == "mem_7"


@pytest.mark.parametrize("agent_name", ["linkedin", "instagram", "twitter"])
def test_strategist_agents_call_load_strategist_memory(agent_name: str) -> None:
    from agents.base_agent import BaseAgent

    mapped = [
        {
            "id": "mem_1",
            "kind": "voice",
            "content": "Calm",
            "source": "user",
            "platform": agent_name,
            "created_at": None,
        }
    ]
    seen: dict[str, Any] = {}

    class _Agent(BaseAgent):
        structured_output = True

        def generate_judged(self, *args: Any, **kwargs: Any):  # type: ignore[override]
            seen["judge_memory"] = kwargs.get("avatar_memory")
            self._last_raw = f'{{"agent":"{agent_name}","mode":"chat","reply":"ok"}}'
            self._last_usage = {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
            self._last_review = None
            if False:
                yield {}

        def generate_structured(self, messages: Any):  # type: ignore[override]
            self._last_raw = f'{{"agent":"{agent_name}","mode":"chat","reply":"ok"}}'
            self._last_usage = {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
            if False:
                yield ""

    _Agent.agent_type = agent_name

    def _assemble(*_args: Any, **kwargs: Any) -> dict[str, Any]:
        seen["context_memory"] = kwargs.get("avatar_memory")
        return {"avatar_memory": {}, "user_input": "hi"}

    with (
        patch(
            "context.avatar_resolve.resolve_avatar_ids",
            return_value=[AVATAR_ID],
        ),
        patch(
            "context.avatar_context.build_avatar_context",
            return_value={
                "avatars": [{"id": AVATAR_ID}],
                "profiles": [{"avatar_id": AVATAR_ID}],
                "profile": {"avatar_id": AVATAR_ID},
                "summaries": [],
                "competitor_context": [],
                "relevant_insights": [],
                "tools_used": [],
                "multi_avatar": False,
            },
        ),
        patch(
            "services.avatar_memory.load_strategist_memory",
            return_value=mapped,
        ) as helper,
        patch("services.avatar_memory.load_avatar_memory") as legacy,
        patch("agents.base_agent.assemble_context", side_effect=_assemble),
        patch("services.avatar_memory.save_memory_updates", return_value=[]),
        patch(
            "agents.base_agent.should_run_draft_judge",
            return_value=True,
        ),
        patch("agents.base_agent.get_system_prompt", return_value="system"),
        patch("agents.base_agent.response_language_instruction", return_value=""),
        patch("services.competitor_style.load_competitor_post_style", return_value=None),
        patch("services.content_plan.load_recent_content_performance", return_value=[]),
        patch("services.x_account.tweet_limit_for_avatar", return_value=280),
        patch("services.draft_grounding.strip_unsupported_quotes", return_value=0),
        patch(
            "services.draft_grounding.filter_memory_updates",
            side_effect=lambda updates, _allowed: updates or [],
        ),
        patch("services.draft_grounding.build_allowed_text", return_value=""),
    ):
        events = list(
            _Agent().run(
                user_id=USER_ID,
                avatar_id=AVATAR_ID,
                agent_type=agent_name,
                user_input="Write something",
                chatbot_context_on=True,
                stream=False,
            )
        )

    helper.assert_called_once_with(
        user_id=USER_ID,
        avatar_id=AVATAR_ID,
        user_input="Write something",
    )
    legacy.assert_not_called()
    assert seen.get("context_memory") is mapped, events
    assert seen.get("judge_memory") is mapped


@pytest.mark.parametrize(
    ("agent_name", "task", "chatbot_context_on"),
    [
        ("linkedin", "revise", False),
        ("chatbot", None, True),
        ("playbook", None, False),
    ],
)
def test_revise_chatbot_and_playbook_do_not_use_strategist_helper(
    agent_name: str,
    task: str | None,
    chatbot_context_on: bool,
) -> None:
    from agents.base_agent import BaseAgent

    class _Agent(BaseAgent):
        structured_output = agent_name != "chatbot"

        def generate_structured(self, messages: Any):  # type: ignore[override]
            self._last_raw = f'{{"agent":"{agent_name}","mode":"chat","reply":"ok"}}'
            self._last_usage = {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
            if False:
                yield ""

        def stream_with_continuation(self, messages: Any):  # type: ignore[override]
            self._last_raw = "hello"
            self._last_usage = {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
            yield "hello"

        def run_playbook_with_tools(self, user_input: str, messages: Any):  # type: ignore[override]
            return (
                '{"agent":"playbook","reasoning":"ok"}',
                {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
                [],
            )

    _Agent.agent_type = agent_name

    with (
        patch(
            "context.avatar_resolve.resolve_avatar_ids",
            return_value=[AVATAR_ID],
        ),
        patch(
            "context.avatar_context.build_avatar_context",
            return_value={
                "avatars": [{"id": AVATAR_ID}],
                "profiles": [{"avatar_id": AVATAR_ID}],
                "profile": {"avatar_id": AVATAR_ID},
                "summaries": [],
                "competitor_context": [],
                "relevant_insights": [],
                "tools_used": [],
                "multi_avatar": False,
            },
        ),
        patch("services.avatar_memory.load_strategist_memory") as helper,
        patch("services.avatar_memory.load_avatar_memory") as legacy,
        patch(
            "agents.base_agent.assemble_context",
            return_value={"avatar_memory": {}, "user_input": "hi"},
        ),
        patch("services.avatar_memory.save_memory_updates", return_value=[]),
        patch("agents.base_agent.should_run_draft_judge", return_value=False),
        patch("agents.base_agent.get_system_prompt", return_value="system"),
        patch("agents.base_agent.revise_system_prompt", return_value="revise"),
        patch("agents.base_agent.response_language_instruction", return_value=""),
        patch.object(
            BaseAgent,
            "select_tools",
            return_value={
                "profile": None,
                "summaries": [],
                "playbooks": [],
                "similar": [],
                "scrape_result": None,
                "tools_used": [],
            },
        ),
    ):
        list(
            _Agent().run(
                user_id=USER_ID,
                avatar_id=AVATAR_ID,
                agent_type=agent_name,
                user_input="CURRENT POST\nok\nINSTRUCTION\nfix",
                chatbot_context_on=chatbot_context_on,
                task=task,
                stream=False,
            )
        )

    helper.assert_not_called()
    legacy.assert_not_called()
