"""Chatbot PROFILE_READ: Supermemory primary when brand context is on."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from agents.base_agent import BaseAgent, uses_supermemory_profile_context  # noqa: E402
from services.profile_context import ProfileContextResult  # noqa: E402

AVATAR_ID = "00000000-0000-4000-8000-000000000001"
USER_ID = "user-1"


@pytest.mark.parametrize(
    ("agent_type", "chatbot_context_on", "revise", "expected"),
    [
        ("linkedin", False, False, True),
        ("instagram", False, False, True),
        ("twitter", False, False, True),
        ("chatbot", True, False, True),
        ("chatbot", False, False, False),
        ("playbook", True, False, False),
        ("linkedin", False, True, False),
        ("chatbot", True, True, False),
    ],
)
def test_uses_supermemory_profile_context_gate(
    agent_type: str,
    chatbot_context_on: bool,
    revise: bool,
    expected: bool,
) -> None:
    assert (
        uses_supermemory_profile_context(
            agent_type,
            chatbot_context_on=chatbot_context_on,
            revise=revise,
        )
        is expected
    )


def _run_chatbot(*, context_on: bool) -> tuple[Any, ...]:
    class _Agent(BaseAgent):
        agent_type = "chatbot"
        structured_output = False

        def stream_with_continuation(self, messages: Any):  # type: ignore[override]
            self._last_raw = "hello from chat"
            self._last_usage = {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
            yield "hello from chat"

    seen: dict[str, Any] = {}

    def _assemble(*_args: Any, **kwargs: Any) -> dict[str, Any]:
        seen["profile"] = kwargs.get("profile")
        return {
            "brand_profile": kwargs.get("profile") or {},
            "avatar_memory": {},
            "user_input": "hi",
        }

    profile_read = ProfileContextResult(
        source="supermemory",
        content="from supermemory profile doc",
        processing_status="done",
        status_code=200,
    )

    with (
        patch(
            "context.avatar_resolve.resolve_avatar_ids",
            return_value=[AVATAR_ID],
        ),
        patch(
            "context.avatar_context.build_avatar_context",
            return_value={
                "avatars": [{"id": AVATAR_ID}],
                "profiles": [{"avatar_id": AVATAR_ID, "profiling_data": {"a": 1}}],
                "profile": {
                    "avatar_id": AVATAR_ID,
                    "profiling_data": {"a": 1},
                    "profile_summary": "old summary",
                },
                "summaries": [],
                "competitor_context": [],
                "relevant_insights": [],
                "tools_used": [],
                "multi_avatar": False,
            },
        ),
        patch(
            "services.profile_context.load_strategist_profile_context",
            return_value=profile_read,
        ) as load_profile,
        patch(
            "services.profile_context.apply_strategist_profile_context",
            side_effect=lambda profile, result, agent_type=None: {
                **(profile or {}),
                "profile_context": result.content,
                "profile_context_source": result.source,
                "profile_summary": None,
            },
        ) as apply_profile,
        patch("services.avatar_memory.load_strategist_memory") as memory_helper,
        patch("agents.base_agent.assemble_context", side_effect=_assemble),
        patch("agents.base_agent.get_system_prompt", return_value="system"),
        patch("agents.base_agent.response_language_instruction", return_value=""),
        patch(
            "services.profile_context.log_strategist_profile_llm_handoff"
        ) as handoff,
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
        agent = _Agent()
        agent.mcp = MagicMock()
        agent.mcp.call_tool.return_value = []
        events = list(
            agent.run(
                user_id=USER_ID,
                avatar_id=AVATAR_ID,
                agent_type="chatbot",
                user_input="What is my brand voice?",
                chatbot_context_on=context_on,
                stream=False,
            )
        )
    return events, load_profile, apply_profile, handoff, memory_helper, seen


def test_chatbot_with_context_loads_supermemory_profile() -> None:
    events, load_profile, apply_profile, handoff, memory_helper, seen = _run_chatbot(
        context_on=True
    )
    load_profile.assert_called_once()
    assert load_profile.call_args.kwargs["avatar_id"] == AVATAR_ID
    assert load_profile.call_args.kwargs["agent_type"] == "chatbot"
    apply_profile.assert_called_once()
    handoff.assert_called_once()
    memory_helper.assert_not_called()
    assert seen["profile"]["profile_context"] == "from supermemory profile doc"
    assert seen["profile"]["profile_context_source"] == "supermemory"
    assert seen["profile"]["profile_summary"] is None
    assert any(e.get("event") == "complete" for e in events)


def test_chatbot_without_context_skips_profile_read() -> None:
    _events, load_profile, apply_profile, handoff, memory_helper, seen = _run_chatbot(
        context_on=False
    )
    load_profile.assert_not_called()
    apply_profile.assert_not_called()
    handoff.assert_not_called()
    memory_helper.assert_not_called()
    # Context-off path may not assemble a brand profile at all.
    assert seen.get("profile") in (None, {})
