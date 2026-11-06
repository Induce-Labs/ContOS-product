"""Unit tests for Supermemory-first strategist memory writes."""

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
    STRATEGIST_MEMORY_ORIGIN,
    save_memory_updates,
)
from services.draft_grounding import filter_memory_updates  # noqa: E402
from services.supermemory import (  # noqa: E402
    SupermemoryResponse,
    memory_document_id,
)

AVATAR_ID = "00000000-0000-4000-8000-000000000001"
OTHER_AVATAR_ID = "00000000-0000-4000-8000-000000000099"
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


def _conflict() -> SupermemoryResponse:
    return SupermemoryResponse(
        ok=False,
        operation="create_document",
        status_code=409,
        error="http_error",
        elapsed_ms=3.0,
    )


def _fail(
    *,
    error: str = "http_error",
    status_code: int | None = 500,
) -> SupermemoryResponse:
    return SupermemoryResponse(
        ok=False,
        operation="create_document",
        status_code=status_code,
        error=error,  # type: ignore[arg-type]
        elapsed_ms=2.0,
    )


def test_valid_strategist_memory_writes_to_supermemory() -> None:
    content = "Prefer short LinkedIn posts"
    expected_id = memory_document_id("voice", content)
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED) as owned,
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.create_document",
            return_value=_ok_create(expected_id),
        ) as create,
        patch("db.supabase_client._require_client") as supabase_client,
    ):
        saved = save_memory_updates(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            platform="linkedin",
            updates=[
                {
                    "kind": "voice",
                    "content": content,
                    "source": "user",
                }
            ],
        )

    assert len(saved) == 1
    assert saved[0]["id"] == expected_id
    assert saved[0]["kind"] == "voice"
    assert saved[0]["content"] == content
    assert saved[0]["source"] == "user"
    assert saved[0]["platform"] == "linkedin"
    assert saved[0]["avatar_id"] == AVATAR_ID
    owned.assert_called_once_with(AVATAR_ID, USER_ID)
    create.assert_called_once_with(
        f"avatar_{AVATAR_ID}",
        expected_id,
        content,
        metadata={
            "kind": "voice",
            "source": "user",
            "platform": "linkedin",
            "origin": STRATEGIST_MEMORY_ORIGIN,
        },
    )
    supabase_client.assert_not_called()


def test_rejection_memory_writes_with_rejection_kind() -> None:
    content = "No emoji in posts"
    expected_id = memory_document_id("rejection", content)
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
            platform="twitter",
            updates=[{"kind": "rejection", "content": content, "source": "user"}],
        )

    assert saved[0]["kind"] == "rejection"
    assert create.call_args.kwargs["metadata"]["kind"] == "rejection"
    assert create.call_args.kwargs["metadata"]["platform"] == "twitter"


def test_invalid_and_ungrounded_updates_never_reach_supermemory() -> None:
    allowed = "keep the tone calm"
    filtered = filter_memory_updates(
        [
            {"kind": "voice", "content": 'User said "totally invented quote"', "source": "user"},
            {"kind": "not-a-kind", "content": "valid looking", "source": "user"},
            {"kind": "voice", "content": "   ", "source": "user"},
            "not-a-dict",
            {"kind": "voice", "content": "keep the tone calm", "source": "user"},
        ],
        allowed,
    )
    # Quote filter drops invented quotes; kind/blank still need save_memory_updates.
    assert all("invented quote" not in str(item.get("content")) for item in filtered)

    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.create_document",
            return_value=_ok_create(),
        ) as create,
    ):
        saved = save_memory_updates(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            platform="linkedin",
            updates=[
                {"kind": "bogus", "content": "nope", "source": "user"},
                {"kind": "voice", "content": "", "source": "user"},
                {"kind": "voice", "content": "keep the tone calm", "source": "weird"},
            ],
        )

    assert len(saved) == 1
    assert saved[0]["source"] == "inferred"
    assert create.call_count == 1
    assert create.call_args.args[2] == "keep the tone calm"


def test_duplicate_submission_is_idempotent_on_conflict() -> None:
    content = "Prefer short posts"
    expected_id = memory_document_id("voice", content)
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.create_document",
            return_value=_conflict(),
        ) as create,
        patch("services.supermemory.update_document") as update,
    ):
        saved = save_memory_updates(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            platform="instagram",
            updates=[
                {"kind": "voice", "content": content, "source": "user"},
                {"kind": "voice", "content": content, "source": "user"},
            ],
        )

    assert len(saved) == 1
    assert saved[0]["id"] == expected_id
    create.assert_called_once()
    update.assert_not_called()


def test_transient_failure_retries_then_skips_without_raising() -> None:
    content = "One clear takeaway"
    responses = [
        _fail(error="timeout", status_code=None),
        _fail(status_code=503),
        _fail(status_code=500),
    ]
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.create_document",
            side_effect=responses,
        ) as create,
        patch("services.avatar_memory.time.sleep") as sleep,
        patch("db.supabase_client._require_client") as supabase_client,
    ):
        saved = save_memory_updates(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            platform="linkedin",
            updates=[{"kind": "voice", "content": content, "source": "user"}],
        )

    assert saved == []
    assert create.call_count == 3
    assert sleep.call_count == 2
    supabase_client.assert_not_called()


def test_permanent_client_error_is_not_retried() -> None:
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.create_document",
            return_value=_fail(status_code=400),
        ) as create,
        patch("services.avatar_memory.time.sleep") as sleep,
    ):
        saved = save_memory_updates(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            platform="linkedin",
            updates=[
                {
                    "kind": "voice",
                    "content": "Prefer short concrete posts",
                    "source": "inferred",
                }
            ],
        )

    assert saved == []
    create.assert_called_once()
    sleep.assert_not_called()


def test_missing_configuration_skips_without_supabase_insert() -> None:
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=False),
        patch("services.supermemory.create_document") as create,
        patch("db.supabase_client._require_client") as supabase_client,
    ):
        saved = save_memory_updates(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            platform="linkedin",
            updates=[{"kind": "voice", "content": "Calm tone", "source": "user"}],
        )

    assert saved == []
    create.assert_not_called()
    supabase_client.assert_not_called()


def test_namespace_uses_owned_avatar_not_request_argument() -> None:
    with (
        patch(
            "db.supabase_client.assert_avatar_owned",
            return_value=OWNED,
        ) as owned_check,
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.create_document",
            return_value=_ok_create(),
        ) as create,
    ):
        save_memory_updates(
            user_id=USER_ID,
            avatar_id="client-supplied-id",
            platform="linkedin",
            updates=[{"kind": "goal", "content": "Grow authority", "source": "user"}],
        )

    owned_check.assert_called_once_with("client-supplied-id", USER_ID)
    assert create.call_args.args[0] == f"avatar_{AVATAR_ID}"


def test_multi_avatar_isolation_uses_each_owned_namespace() -> None:
    other_owned = {"id": OTHER_AVATAR_ID, "user_id": USER_ID}
    content = "Platform-specific voice"
    with (
        patch(
            "db.supabase_client.assert_avatar_owned",
            side_effect=[OWNED, other_owned],
        ),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.create_document",
            return_value=_ok_create(),
        ) as create,
    ):
        save_memory_updates(
            user_id=USER_ID,
            avatar_id=AVATAR_ID,
            platform="linkedin",
            updates=[{"kind": "voice", "content": content, "source": "user"}],
        )
        save_memory_updates(
            user_id=USER_ID,
            avatar_id=OTHER_AVATAR_ID,
            platform="instagram",
            updates=[{"kind": "voice", "content": content, "source": "user"}],
        )

    namespaces = [c.args[0] for c in create.call_args_list]
    assert namespaces == [f"avatar_{AVATAR_ID}", f"avatar_{OTHER_AVATAR_ID}"]
    assert create.call_args_list[0].args[1] == create.call_args_list[1].args[1]


def test_load_avatar_memory_fallback_unchanged() -> None:
    from services.avatar_memory import load_avatar_memory

    rows = [{"id": "legacy", "kind": "note", "content": "old"}]
    client = MagicMock()
    query = MagicMock()
    client.table.return_value = query
    query.select.return_value = query
    query.eq.return_value = query
    query.order.return_value = query
    query.limit.return_value = query
    query.execute.return_value = MagicMock(data=rows)

    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("db.supabase_client._require_client", return_value=client),
    ):
        loaded = load_avatar_memory(user_id=USER_ID, avatar_id=AVATAR_ID)

    assert loaded == rows
    client.table.assert_called_once_with("avatar_memory")


def test_base_agent_strategist_write_uses_supermemory_not_supabase() -> None:
    from agents.base_agent import BaseAgent

    content = "Prefer operator metrics"
    expected_id = memory_document_id("voice", content)
    create_calls: list[Any] = []

    class _Agent(BaseAgent):
        structured_output = True

        def generate_judged(self, *args: Any, **kwargs: Any):  # type: ignore[override]
            self._last_raw = (
                '{"agent":"linkedin","mode":"chat","reply":"ok",'
                f'"memory_updates":[{{"kind":"voice","content":"{content}","source":"user"}}]}}'
            )
            self._last_usage = {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
            self._last_review = None
            if False:
                yield {}

        def generate_structured(self, messages: Any):  # type: ignore[override]
            self._last_raw = self._last_raw or "{}"
            self._last_usage = {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
            if False:
                yield ""

    _Agent.agent_type = "linkedin"

    def _create(*args: Any, **kwargs: Any) -> SupermemoryResponse:
        create_calls.append((args, kwargs))
        return _ok_create(expected_id)

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
            return_value=[],
        ),
        patch("agents.base_agent.assemble_context", return_value={"user_input": "hi"}),
        patch("agents.base_agent.should_run_draft_judge", return_value=True),
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
        patch("services.draft_grounding.build_allowed_text", return_value=content.lower()),
        patch("db.supabase_client.assert_avatar_owned", return_value=OWNED),
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch("services.supermemory.create_document", side_effect=_create),
        patch("db.supabase_client._require_client") as supabase_client,
        patch("services.avatar_memory.load_avatar_memory") as legacy_load,
    ):
        events = list(
            _Agent().run(
                user_id=USER_ID,
                avatar_id=AVATAR_ID,
                agent_type="linkedin",
                user_input="Write something",
                chatbot_context_on=True,
                stream=False,
            )
        )

    assert create_calls, events
    args, kwargs = create_calls[0]
    assert args[0] == f"avatar_{AVATAR_ID}"
    assert args[1] == expected_id
    assert args[2] == content
    assert kwargs["metadata"]["origin"] == STRATEGIST_MEMORY_ORIGIN
    avatar_memory_table_calls = [
        c
        for c in supabase_client.return_value.table.call_args_list
        if c.args and c.args[0] == "avatar_memory"
    ]
    assert avatar_memory_table_calls == []
    legacy_load.assert_not_called()


def test_chatbot_and_playbook_do_not_write_memory() -> None:
    from agents.base_agent import BaseAgent

    for agent_name in ("chatbot", "playbook"):

        class _Agent(BaseAgent):
            structured_output = agent_name != "chatbot"

            def generate_structured(self, messages: Any):  # type: ignore[override]
                self._last_raw = (
                    f'{{"agent":"{agent_name}","mode":"chat","reply":"ok",'
                    '"memory_updates":[{"kind":"voice","content":"x","source":"user"}]}'
                )
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
            patch("services.avatar_memory.load_strategist_memory") as load_helper,
            patch("services.avatar_memory.save_memory_updates") as save_helper,
            patch(
                "agents.base_agent.assemble_context",
                return_value={"avatar_memory": {}, "user_input": "hi"},
            ),
            patch("agents.base_agent.should_run_draft_judge", return_value=False),
            patch("agents.base_agent.get_system_prompt", return_value="system"),
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
                    user_input="hi",
                    chatbot_context_on=True,
                    stream=False,
                )
            )

        load_helper.assert_not_called()
        save_helper.assert_not_called()


def test_profile_sync_unaffected_by_memory_write_helper() -> None:
    from services.supermemory import PROFILE_DOCUMENT_ID, sync_profile_to_supermemory

    with (
        patch("services.supermemory.is_supermemory_configured", return_value=True),
        patch(
            "services.supermemory.get_document",
            return_value=SupermemoryResponse(
                ok=False,
                operation="get_document",
                status_code=404,
                error="http_error",
            ),
        ),
        patch(
            "services.supermemory.create_document",
            return_value=SupermemoryResponse(
                ok=True,
                operation="create_document",
                status_code=200,
                data={"id": "profile", "status": "queued"},
                elapsed_ms=1.0,
            ),
        ) as create,
        patch("services.avatar_memory.save_memory_updates") as save,
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data={"content_goal": "Leads"},
        )
        save.assert_not_called()

    assert result.ok is True
    assert create.call_args.args[1] == PROFILE_DOCUMENT_ID
    assert create.call_args.kwargs["metadata"]["kind"] == "profile"
    assert create.call_args.kwargs["metadata"]["source"] == "contos_profile"
    assert "origin" not in create.call_args.kwargs["metadata"]
