"""A revise call edits one post and does not receive history, context, or the draft judge."""

from agents.base_agent import BaseAgent
from prompts.strategist_core import (
    revise_system_prompt,
    should_run_draft_judge,
)


def test_revise_prompt_changes_only_what_was_asked():
    prompt = revise_system_prompt("linkedin")
    assert "Change only the words the instruction names" in prompt
    assert "Do not invent facts" in prompt
    assert "CONTENT FIRST" not in prompt
    assert "write every post fresh" not in prompt.lower()


def test_revise_skips_the_draft_judge():
    assert should_run_draft_judge("linkedin", structured=True, task="revise") is False
    assert should_run_draft_judge("instagram", structured=True, task="revise") is False
    assert should_run_draft_judge("twitter", structured=True, task="revise") is False
    assert should_run_draft_judge("linkedin", structured=True, task=None) is True
    assert should_run_draft_judge("chatbot", structured=False, task=None) is False


def test_revise_messages_omit_history_context_and_suggestion_rules():
    agent = BaseAgent()
    agent.agent_type = "linkedin"
    agent.structured_output = True
    messages = agent.build_messages(
        revise_system_prompt("linkedin"),
        {"competitor_intelligence": [{"competitor_handle": "secret-handle"}]},
        "CURRENT POST:\nHello\n\nINSTRUCTION:\nchange Hello to Hi",
        chat_history=[{"role": "user", "content": "earlier secret"}],
        revise=True,
    )
    assert [message["role"] for message in messages] == ["system", "user"]
    combined = "\n".join(message["content"] for message in messages)
    assert "earlier secret" not in combined
    assert "secret-handle" not in combined
    assert "CONTEXT" not in combined
    assert "wrap details the user did not give" not in combined
