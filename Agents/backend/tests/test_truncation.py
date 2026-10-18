"""Replies that hit the token cap must be continued or retried, never shown cut off."""

from types import SimpleNamespace

from agents.chatbot_agent import ChatbotAgent
from agents.linkedin_agent import LinkedInAgent


def _stream_script(agent, parts):
    """Make agent.stream_llm yield scripted (text, finish_reason) rounds."""
    rounds = iter(parts)
    calls = []

    def fake_stream(messages, tools=None):
        calls.append(messages)
        text, finish = next(rounds)
        agent._last_raw = text
        agent._last_finish_reason = finish
        agent._last_usage = {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
        yield text

    agent.stream_llm = fake_stream
    return calls


def test_chatbot_continues_after_length_cutoff():
    agent = ChatbotAgent()
    calls = _stream_script(agent, [("First half of the answ", "length"), ("answer, finished.", "stop")])
    streamed = "".join(agent.stream_with_continuation([{"role": "user", "content": "q"}]))
    assert streamed.startswith("First half of the answ")
    assert agent._last_raw == "First half of the answer, finished."
    assert agent._last_usage["total_tokens"] == 30
    assert len(calls) == 2
    assert calls[1][-2] == {"role": "assistant", "content": "First half of the"}
    assert "First half of the" in calls[1][-1]["content"]
    assert "cut off" in calls[1][-1]["content"]


def test_chatbot_stops_continuing_after_limit():
    agent = ChatbotAgent()
    calls = _stream_script(agent, [("one two", "length"), ("two three", "length"), ("three four", "length")])
    list(agent.stream_with_continuation([{"role": "user", "content": "q"}], max_continuations=2))
    assert agent._last_raw == "one two three four"
    assert len(calls) == 3


def test_complete_reply_is_not_continued():
    agent = ChatbotAgent()
    calls = _stream_script(agent, [("Done.", "stop")])
    assert "".join(agent.stream_with_continuation([{"role": "user", "content": "q"}])) == "Done."
    assert len(calls) == 1


def test_structured_reply_retried_with_bigger_budget(monkeypatch):
    monkeypatch.setenv("AGENT_MAX_TOKENS", "2500")
    agent = LinkedInAgent()
    seen = []

    def fake_complete(messages, tools=None, temperature=0.2, max_tokens=None):
        seen.append(max_tokens)
        agent._last_finish_reason = "length" if len(seen) == 1 else "stop"
        return SimpleNamespace(), '{"ok": true}', {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}

    agent.complete_llm = fake_complete
    _, content, usage = agent.complete_untruncated([{"role": "user", "content": "q"}])
    assert seen[0] is None and seen[1] == 5000
    assert usage["total_tokens"] == 4
    assert content == '{"ok": true}'


def test_structured_reply_not_retried_when_complete():
    agent = LinkedInAgent()
    count = []

    def fake_complete(messages, tools=None, temperature=0.2, max_tokens=None):
        count.append(1)
        agent._last_finish_reason = "stop"
        return SimpleNamespace(), "{}", {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}

    agent.complete_llm = fake_complete
    agent.complete_untruncated([{"role": "user", "content": "q"}])
    assert len(count) == 1


def test_seam_gets_a_space_when_the_provider_strips_it():
    agent = ChatbotAgent()
    _stream_script(agent, [("Most founders use quote-heavy", "length"), ("quote-heavy content that feels safe.", "stop")])
    list(agent.stream_with_continuation([{"role": "user", "content": "q"}]))
    assert agent._last_raw == "Most founders use quote-heavy content that feels safe."


def test_seam_keeps_punctuation_attached():
    agent = ChatbotAgent()
    _stream_script(agent, [("It works well", "length"), ("well, honestly.", "stop")])
    list(agent.stream_with_continuation([{"role": "user", "content": "q"}]))
    assert agent._last_raw == "It works well, honestly."


def test_seam_keeps_paragraph_break():
    agent = ChatbotAgent()
    _stream_script(agent, [("First point.\n\nSecond", "length"), ("Second point.", "stop")])
    list(agent.stream_with_continuation([{"role": "user", "content": "q"}]))
    assert agent._last_raw == "First point.\n\nSecond point."


def test_no_cap_by_default(monkeypatch):
    from agents.base_agent import _max_tokens_for

    monkeypatch.delenv("AGENT_MAX_TOKENS", raising=False)
    monkeypatch.delenv("CHATBOT_MAX_TOKENS", raising=False)
    assert _max_tokens_for("linkedin", True) is None
    assert _max_tokens_for("chatbot", False) is None
    monkeypatch.setenv("AGENT_MAX_TOKENS", "")
    assert _max_tokens_for("linkedin", True) is None
    monkeypatch.setenv("AGENT_MAX_TOKENS", "0")
    assert _max_tokens_for("linkedin", True) is None


def test_cap_from_environment(monkeypatch):
    from agents.base_agent import _max_tokens_for

    monkeypatch.setenv("CHATBOT_MAX_TOKENS", "900")
    monkeypatch.setenv("AGENT_MAX_TOKENS", "3000")
    assert _max_tokens_for("chatbot", False) == 900
    assert _max_tokens_for("instagram", True) == 3000


def test_no_cap_means_no_max_tokens_sent_and_no_retry(monkeypatch):
    monkeypatch.delenv("AGENT_MAX_TOKENS", raising=False)
    agent = LinkedInAgent()
    count = []

    def fake_complete(messages, tools=None, temperature=0.2, max_tokens=None):
        count.append(max_tokens)
        agent._last_finish_reason = "length"
        return SimpleNamespace(), "{}", {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}

    agent.complete_llm = fake_complete
    agent.complete_untruncated([{"role": "user", "content": "q"}])
    assert count == [None]


def test_credit_error_without_cap_retries_within_budget():
    from agents import base_agent

    sent = []

    class FakeClient:
        class chat:
            class completions:
                @staticmethod
                def create(**kw):
                    sent.append(kw.get("max_tokens"))
                    if len(sent) == 1:
                        raise RuntimeError("402 can only afford 3000 tokens")
                    return "ok"

    assert base_agent._create_chat_completion(FakeClient(), {"model": "m", "messages": []}) == "ok"
    assert sent == [None, 2200]
