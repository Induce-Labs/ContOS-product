"""Chatbot Agent — general or context-aware conversational assistant."""

from __future__ import annotations

import re
import threading
from collections.abc import Generator
from typing import Any

from agents.base_agent import BaseAgent
from constants import LANGUAGE_DISPLAY_NAMES, normalize_response_language


_GREETING_RE = re.compile(
    r"^(hi|hii+|hello|hey|yo|sup|hiya|good\s*(morning|afternoon|evening)|howdy|hola|"
    r"bonjour|salut|bonsoir|namaste|namaskar|ninhao|ni\s*hao|ciao)"
    r"([\s,.!?]|$)",
    re.I,
)

_INSTANT_GREETING_BY_LANG: dict[str, str] = {
    "en": (
        "Hey! I'm ContOS, your fractional CMO assistant. "
        "What would you like help with today?"
    ),
    "hi": (
        "नमस्ते! मैं ContOS हूँ, आपका fractional CMO सहायक। "
        "आज मैं आपकी किस तरह मदद कर सकता हूँ?"
    ),
    "zh": "你好！我是 ContOS，你的 fractional CMO 助手。今天想让我帮你做什么？",
    "fr": (
        "Salut ! Je suis ContOS, votre assistant fractional CMO. "
        "Comment puis-je vous aider aujourd'hui ?"
    ),
    "es": (
        "¡Hola! Soy ContOS, tu asistente fractional CMO. "
        "¿En qué te puedo ayudar hoy?"
    ),
}


def _is_greeting(text: str) -> bool:
    """True only for a bare greeting ("hi", "hello there"), never "hey, what can I do...?"."""
    t = (text or "").strip()
    if not t or len(t) > 60 or "?" in t:
        return False
    match = _GREETING_RE.match(t)
    if not match:
        return False
    remainder = re.sub(r"[^\w\s]", " ", t[match.end():]).split()
    return len(remainder) <= 2


def _instant_greeting(response_language: str) -> str:
    try:
        code = normalize_response_language(response_language)
    except ValueError:
        code = "en"
    return _INSTANT_GREETING_BY_LANG.get(code, _INSTANT_GREETING_BY_LANG["en"])


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
        avatar_id: str,
        agent_type: str | None = None,
        user_input: str = "",
        live_mode: bool = False,
        chatbot_context_on: bool = False,
        competitor_url: str | None = None,
        competitor_summaries: list[dict[str, Any]] | None = None,
        tagged_avatar_ids: list[str] | None = None,
        chat_history: list[dict[str, str]] | None = None,
        response_language: str = "en",
        stream: bool = True,
        task: str | None = None,
    ) -> Generator[dict[str, Any], None, None]:
        # Instant path for greetings — skip OpenRouter entirely
        # (skip when prior turns exist so mid-thread "hi" still uses memory)
        if (
            _is_greeting(user_input)
            and not live_mode
            and not competitor_summaries
            and not chat_history
            and task != "revise"
        ):
            reply = _instant_greeting(response_language)
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
                    "response_language": response_language,
                },
            }
            threading.Thread(
                target=_log_async,
                args=(
                    {
                        "user_id": user_id,
                        "avatar_id": avatar_id,
                        "agent_type": "chatbot",
                        "user_input": user_input,
                        "context_snapshot": {
                            "instant_greeting": True,
                            "response_language": response_language,
                            "language_name": LANGUAGE_DISPLAY_NAMES.get(
                                (response_language or "en").split("-")[0].lower(),
                                "English",
                            ),
                        },
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
            avatar_id=avatar_id,
            agent_type=agent_type or "chatbot",
            user_input=user_input,
            live_mode=live_mode,
            chatbot_context_on=chatbot_context_on,
            competitor_url=competitor_url,
            competitor_summaries=competitor_summaries,
            tagged_avatar_ids=tagged_avatar_ids,
            chat_history=chat_history,
            response_language=response_language,
            stream=stream,
            task=task,
        )
