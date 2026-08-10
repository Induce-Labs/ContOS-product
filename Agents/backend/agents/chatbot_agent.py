"""Chatbot Agent — general or context-aware conversational assistant."""

from __future__ import annotations

import re
import threading
from collections.abc import Generator
from typing import Any

from agents.base_agent import BaseAgent


_GREETING_RE = re.compile(
    r"^(hi|hii+|hello|hey|yo|sup|hiya|good\s*(morning|afternoon|evening)|howdy|hola)"
    r"([\s,.!?]|$)",
    re.I,
)


def _is_greeting(text: str) -> bool:
    t = (text or "").strip()
    if not t or len(t) > 60:
        return False
    return bool(_GREETING_RE.match(t))


def _log_async(payload: dict[str, Any]) -> None:
    try:
        from db.supabase_client import log_agent_call

        log_agent_call(payload)
    except Exception:
        pass


class ChatbotAgent(BaseAgent):
    agent_type = "chatbot"
    structured_output = False

    def run(
        self,
        user_id: str,
        project_id: str,
        agent_type: str | None = None,
        user_input: str = "",
        live_mode: bool = False,
        chatbot_context_on: bool = False,
        competitor_url: str | None = None,
        competitor_summaries: list[dict[str, Any]] | None = None,
        stream: bool = True,
    ) -> Generator[dict[str, Any], None, None]:
        # Instant path for greetings — skip OpenRouter entirely
        if _is_greeting(user_input) and not live_mode and not competitor_summaries:
            reply = (
                "Hey! I'm ContOS — your fractional CMO assistant. "
                "What would you like help with today?"
            )
            yield {"event": "status", "data": {"stage": "instant_reply", "agent": "chatbot"}}
            for i in range(0, len(reply), 12):
                yield {
                    "event": "token",
                    "data": {"token": reply[i : i + 12].replace("*", "")},
                }
            yield {
                "event": "complete",
                "data": {
                    "agent": "chatbot",
                    "output": reply.replace("*", ""),
                    "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
                    "tools_used": [],
                    "status": "success",
                },
            }
            threading.Thread(
                target=_log_async,
                args=(
                    {
                        "user_id": user_id,
                        "project_id": project_id,
                        "agent_type": "chatbot",
                        "user_input": user_input,
                        "context_snapshot": {"instant_greeting": True},
                        "raw_response": reply,
                        "parsed_output": {"text": reply},
                        "model_used": "instant",
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "total_tokens": 0,
                        "status": "success",
                        "error_message": None,
                    },
                ),
                daemon=True,
            ).start()
            return

        # Keep competitor knowledge base available even on short questions.
        # Never force context OFF when the UI toggle (or KB) already enabled it —
        # short-message skipping was wrongly answering "turn on context" after
        # the user already turned it on.
        if competitor_summaries:
            chatbot_context_on = True

        yield from super().run(
            user_id=user_id,
            project_id=project_id,
            agent_type=agent_type or "chatbot",
            user_input=user_input,
            live_mode=live_mode,
            chatbot_context_on=chatbot_context_on,
            competitor_url=competitor_url,
            competitor_summaries=competitor_summaries,
            stream=stream,
        )
