"""Unit checks for chat history normalization + build_messages memory."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from chat_history import normalize_chat_history
from agents.base_agent import BaseAgent


class _Stub(BaseAgent):
    agent_type = "chatbot"
    structured_output = False


def main() -> int:
    cleaned = normalize_chat_history(
        [
            {"role": "user", "content": "I sell poetry books"},
            {"role": "assistant", "content": "Great — focus on carousels."},
            {"role": "user", "content": "  "},  # skipped
        ]
    )
    assert len(cleaned) == 2
    assert cleaned[0]["role"] == "user"

    try:
        normalize_chat_history([{"role": "system", "content": "nope"}])
        raise AssertionError("expected ValueError")
    except ValueError:
        pass

    agent = _Stub()
    msgs = agent.build_messages(
        system_prompt="You are ContOS.",
        context={"brand_profile": {}},
        user_input="What should I post next?",
        chatbot_context_on=True,
        chat_history=cleaned,
    )
    roles = [m["role"] for m in msgs]
    assert roles == ["system", "user", "assistant", "user"]
    assert "poetry" in msgs[1]["content"]
    assert "USER REQUEST:\nWhat should I post next?" in msgs[-1]["content"]
    assert "CONVERSATION MEMORY" in msgs[-1]["content"]
    print("OK chat history memory")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
