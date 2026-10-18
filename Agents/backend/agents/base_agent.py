"""Shared BaseAgent engine — all ContOS agents inherit from this."""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from collections.abc import Generator
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from constants import response_language_instruction, response_language_user_reminder
from context.assembly import assemble_context
from db.supabase_client import log_agent_call
from mcp.server import TOOL_TRACE, mcp_server
from prompts import get_system_prompt
from schemas.output_schemas import OUTPUT_MODELS

load_dotenv()

logger = logging.getLogger(__name__)

MODEL = os.getenv("LLM_MODEL", "moonshotai/kimi-k2.6")
OPENROUTER_BASE = "https://openrouter.ai/api/v1"


def get_llm_client() -> OpenAI:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENROUTER_API_KEY is not set. Add it to backend/.env to call Kimi via OpenRouter."
        )
    return OpenAI(
        api_key=api_key,
        base_url=OPENROUTER_BASE,
        timeout=180.0,
        # Credit/402 errors should not be auto-retried with the same oversized max_tokens.
        max_retries=0,
    )


def _max_tokens_for(agent_type: str, structured: bool) -> int | None:
    """Completion cap from the environment; None (the default) sends no limit."""
    name = "CHATBOT_MAX_TOKENS" if agent_type == "chatbot" else "AGENT_MAX_TOKENS"
    raw = (os.getenv(name) or "").strip()
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def _log_tokens(agent_type: str, usage: dict[str, int], finish: Any, cap: int | None) -> None:
    logger.info(
        "tokens agent=%s input=%s output=%s total=%s finish=%s cap=%s",
        agent_type,
        usage.get("input_tokens"),
        usage.get("output_tokens"),
        usage.get("total_tokens"),
        finish,
        cap if cap else "none",
    )


def _affordable_tokens_from_error(exc: BaseException) -> int | None:
    """Parse OpenRouter 402 'can only afford N' if present."""
    text = str(exc)
    match = re.search(r"can only afford\s+(\d+)", text, flags=re.IGNORECASE)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _is_credit_limit_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "402" in text or "can only afford" in text or "requires more credits" in text


def _friendly_credit_error(exc: BaseException) -> RuntimeError:
    affordable = _affordable_tokens_from_error(exc)
    hint = (
        f" OpenRouter credits only cover about {affordable} tokens right now."
        if affordable
        else ""
    )
    return RuntimeError(
        "OpenRouter is out of credits for this request."
        f"{hint} Add credits at https://openrouter.ai/settings/credits "
        "or lower AGENT_MAX_TOKENS / prompt size, then try again."
    )


def _create_chat_completion(client: OpenAI, kwargs: dict[str, Any]) -> Any:
    """Create a chat completion; on OpenRouter 402, shrink max_tokens and retry once."""
    try:
        return client.chat.completions.create(**kwargs)
    except Exception as exc:
        if not _is_credit_limit_error(exc):
            raise
        affordable = _affordable_tokens_from_error(exc)
        current = int(kwargs.get("max_tokens") or 0)
        if affordable is None:
            raise _friendly_credit_error(exc) from exc
        # Leave headroom for prompt/system overhead billed against the same balance.
        next_max = max(512, affordable - 800)
        if current:
            next_max = min(current, next_max)
        if current and next_max >= current:
            raise _friendly_credit_error(exc) from exc
        logger.warning(
            "OpenRouter credit limit hit (affordable=%s, requested=%s); retrying with max_tokens=%s",
            affordable,
            current,
            next_max,
        )
        retry_kwargs = dict(kwargs)
        retry_kwargs["max_tokens"] = next_max
        try:
            return client.chat.completions.create(**retry_kwargs)
        except Exception as retry_exc:
            if _is_credit_limit_error(retry_exc):
                raise _friendly_credit_error(retry_exc) from retry_exc
            raise


# Draft text keeps **bold** markers: they mark details the user has not confirmed yet.
DRAFT_TEXT_KEYS = frozenset(
    {"post_structure", "full_tweet", "copy_paste_post", "caption", "hook", "cta", "tweets"}
)


def strip_asterisks(value: Any, _key: str | None = None) -> Any:
    """Remove * from agent-facing text; draft text fields keep their **bold** markers."""
    if value is None:
        return value
    if _key in DRAFT_TEXT_KEYS:
        return value
    if isinstance(value, str):
        return value.replace("*", "")
    if isinstance(value, list):
        return [strip_asterisks(v, _key) for v in value]
    if isinstance(value, dict):
        return {k: strip_asterisks(v, k) for k, v in value.items()}
    return value


def _kimi_no_thinking_body() -> dict[str, Any]:
    """Disable Kimi K2.6 thinking so tokens go to content (verified: effort=none)."""
    return {"reasoning": {"effort": "none", "exclude": True}}


def extract_json(text: str) -> dict[str, Any]:
    """Parse JSON from model output, tolerating fences, prose wrappers, and light truncation."""
    if text is None:
        raise ValueError("Empty model response (no text to parse as JSON)")
    cleaned = text.strip()
    if not cleaned:
        raise ValueError("Empty model response (no text to parse as JSON)")

    # Strip markdown fences
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned)
    if fence:
        cleaned = fence.group(1).strip()

    # Prefer first JSON object span
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    candidate = cleaned[start : end + 1] if start >= 0 and end > start else cleaned

    try:
        data = json.loads(candidate)
    except json.JSONDecodeError:
        repaired = _repair_truncated_json(candidate)
        if repaired is None:
            raise
        data = repaired

    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object, got {type(data).__name__}")
    return _normalize_agent_payload(data)


def _normalize_agent_payload(data: dict[str, Any]) -> dict[str, Any]:
    """Fix common LLM schema drift before validation."""
    agent = data.get("agent")
    if isinstance(agent, dict):
        # Model sometimes returns agent as an object — coerce to string id
        for key in ("name", "type", "id", "linkedin", "instagram", "twitter", "playbook"):
            if key in agent and isinstance(agent[key], str) and key in {
                "linkedin",
                "instagram",
                "twitter",
                "playbook",
            }:
                data["agent"] = key
                break
        else:
            data["agent"] = next(iter(agent.keys()), "unknown")

    # post_ideas as list of strings → wrap
    ideas = data.get("post_ideas")
    if isinstance(ideas, list) and ideas and isinstance(ideas[0], str):
        data["post_ideas"] = [
            {
                "topic": f"Idea {i+1}",
                "hook": idea[:120],
                "post_structure": idea,
                "content_type": "text",
                "cta": "",
                "transcript": "",
                "reasoning": "Normalized from string post idea",
            }
            for i, idea in enumerate(ideas)
        ]

    # draft_kind must be one of the known labels (models sometimes echo the schema hint)
    if "draft_kind" in data and data["draft_kind"] not in ("draft", "plan", "example", ""):
        data["draft_kind"] = ""

    # content_mix as string → keep empty dict
    if isinstance(data.get("content_mix"), str):
        data["content_mix"] = {"note": data["content_mix"]}

    return data


def _repair_truncated_json(text: str) -> dict[str, Any] | None:
    """Best-effort close of truncated JSON objects/arrays/strings."""
    if not text or "{" not in text:
        return None
    s = text.strip()
    in_string = False
    escape = False
    for ch in s:
        if escape:
            escape = False
            continue
        if ch == "\\":
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
    if in_string:
        s += '"'

    s = re.sub(r",\s*$", "", s)
    open_braces = s.count("{") - s.count("}")
    open_brackets = s.count("[") - s.count("]")
    s += "]" * max(0, open_brackets)
    s += "}" * max(0, open_braces)
    try:
        data = json.loads(s)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def _drop_partial_word(text: str) -> tuple[str, str]:
    """Cut a reply back to its last whole word; return (kept text, whitespace that followed it)."""
    if not text or text[-1].isspace():
        body = text.rstrip()
        return body, text[len(body):]
    cut = max(text.rfind(" "), text.rfind("\n"), text.rfind("\t"))
    if cut == -1:
        return text, ""
    body = text[:cut].rstrip()
    if not body:
        return text, ""
    return body, text[len(body) : cut + 1]


def _join_continuation(kept: str, addition: str, sep: str) -> str:
    """Join a continuation onto kept text with correct spacing at the seam."""
    addition = addition.lstrip(" \t")
    if not addition:
        return kept
    if sep and not sep.strip() and addition[0] in ",.;:!?)]}":
        sep = ""
    if not sep and kept and not kept[-1].isspace() and addition[0].isalnum():
        sep = " "
    return kept + sep + addition


STRATEGIST_AGENTS = frozenset({"linkedin", "instagram", "twitter"})


class BaseAgent:
    """Shared pipeline for ContOS specialized agents."""

    agent_type: str = "base"
    structured_output: bool = True

    def __init__(self) -> None:
        self.mcp = mcp_server

    def select_tools(
        self,
        user_id: str,
        avatar_id: str,
        user_input: str,
        live_mode: bool = False,
        chatbot_context_on: bool = False,
        competitor_url: str | None = None,
        competitor_summaries: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        return self.mcp.gather_for_agent(
            agent_type=self.agent_type,
            user_id=user_id,
            avatar_id=avatar_id,
            user_input=user_input,
            live_mode=live_mode,
            chatbot_context_on=chatbot_context_on,
            competitor_url=competitor_url,
            competitor_summaries=competitor_summaries,
        )

    def build_messages(
        self,
        system_prompt: str,
        context: dict[str, Any],
        user_input: str,
        chatbot_context_on: bool = False,
        chat_history: list[dict[str, str]] | None = None,
        response_language: str = "en",
    ) -> list[dict[str, str]]:
        history = [turn for turn in (chat_history or []) if turn.get("content")]
        language_tail = response_language_user_reminder(
            response_language,
            structured=bool(self.structured_output),
        )

        def _with_history(final_user_content: str) -> list[dict[str, str]]:
            messages: list[dict[str, str]] = [
                {"role": "system", "content": system_prompt},
            ]
            for turn in history:
                role = turn.get("role")
                content = (turn.get("content") or "").strip()
                if role not in ("user", "assistant") or not content:
                    continue
                messages.append({"role": role, "content": content})
            messages.append(
                {"role": "user", "content": f"{final_user_content}{language_tail}"}
            )
            return messages

        def _memory_block() -> str:
            if not history:
                return ""
            lines = [
                f"{turn['role'].upper()}: {turn['content']}"
                for turn in history
                if turn.get("role") in ("user", "assistant") and turn.get("content")
            ]
            if not lines:
                return ""
            return (
                "\n\nCONVERSATION MEMORY (prior turns — keep topic continuity only; "
                "do NOT copy their language if RESPONSE LANGUAGE says otherwise):\n"
                + "\n".join(lines)
            )

        if self.agent_type == "chatbot" and not chatbot_context_on:
            return _with_history(f"{user_input}{_memory_block()}")

        context_block = json.dumps(context, default=str)
        user_content = (
            f"CONTEXT (assembled via MCP tools):\n{context_block}\n\n"
            f"USER REQUEST:\n{user_input}"
            f"{_memory_block()}"
        )
        if self.structured_output and self.agent_type in STRATEGIST_AGENTS:
            user_content += (
                "\n\nRespond with valid JSON only, using the envelope and platform fields "
                "from your instructions. Choose exactly one mode. ANSWER THE USER REQUEST "
                "DIRECTLY in reply. Greetings get mode chat with a short reply and no content. "
                "Write the draft right away when asked; do not wait for a thesis. A content request gets the finished post in this "
                "turn; an advice question gets advice and no post. Never use square brackets in a "
                "draft: wrap details the user did not give in **bold** suggestions, and never invent "
                "statistics, results or quotes. Ask at most one next_question. "
                "Use asterisks only for those **bold** suggestions inside draft text."
            )
        elif self.structured_output:
            user_content += (
                "\n\nRespond with valid JSON only matching the required schema. "
                "ANSWER THE USER REQUEST DIRECTLY. Include reasoning for every "
                "recommendation. Be concise. Never use asterisk (*) characters."
            )
        return _with_history(user_content)

    def parse_output(self, raw: str) -> Any:
        if not self.structured_output:
            return raw
        data = extract_json(raw)
        model = OUTPUT_MODELS.get(self.agent_type)
        if model is None:
            return data
        try:
            return model.model_validate(data).model_dump()
        except Exception as exc:
            logger.warning("Schema validation soft-fail for %s: %s", self.agent_type, exc)
            data.setdefault("agent", self.agent_type)
            return data

    def _fallback_output(self, error: str) -> Any:
        if not self.structured_output:
            return (
                f"I hit an error generating a response: {error}. "
                "Please try again or check API configuration."
            )
        return {
            "agent": self.agent_type,
            "error": True,
            "error_message": error,
            "strategy_frameworks": [],
            "guardrails": [],
            "recommendations": [],
            "audit_result": "N/A",
            "broken_rules": [],
            "content_calendar": [],
            "post_ideas": [],
            "tweet_ideas": [],
            "reasoning": f"Fallback due to error: {error}",
        }

    def stream_llm(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None
    ) -> Generator[str, None, tuple[str, dict[str, int]]]:
        """Yield content tokens; track usage on the instance."""
        client = get_llm_client()
        kwargs: dict[str, Any] = {
            "model": MODEL,
            "messages": messages,
            "temperature": 0.3 if self.structured_output else 0.5,
            "stream": True,
            "extra_body": _kimi_no_thinking_body(),
        }
        cap = _max_tokens_for(self.agent_type, self.structured_output)
        if cap:
            kwargs["max_tokens"] = cap
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        if self.structured_output and not tools:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            stream = _create_chat_completion(client, kwargs)
        except Exception as first_exc:
            if _is_credit_limit_error(first_exc):
                raise
            logger.warning(
                "stream_llm with extras failed (%s); retry keeping no-thinking",
                first_exc,
            )
            kwargs.pop("response_format", None)
            kwargs["extra_body"] = _kimi_no_thinking_body()
            stream = _create_chat_completion(client, kwargs)

        full_parts: list[str] = []
        usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        tool_calls_acc: dict[int, dict[str, Any]] = {}
        finish_reason = None

        for chunk in stream:
            if getattr(chunk, "usage", None):
                usage["input_tokens"] = getattr(chunk.usage, "prompt_tokens", 0) or 0
                usage["output_tokens"] = getattr(chunk.usage, "completion_tokens", 0) or 0
                usage["total_tokens"] = getattr(chunk.usage, "total_tokens", 0) or 0

            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            finish_reason = getattr(choice, "finish_reason", None) or finish_reason
            delta = choice.delta
            if delta and delta.content:
                full_parts.append(delta.content)
                yield delta.content

            if delta and getattr(delta, "tool_calls", None):
                for tc in delta.tool_calls:
                    idx = tc.index
                    if idx not in tool_calls_acc:
                        tool_calls_acc[idx] = {
                            "id": tc.id or "",
                            "name": tc.function.name if tc.function else "",
                            "arguments": "",
                        }
                    if tc.id:
                        tool_calls_acc[idx]["id"] = tc.id
                    if tc.function and tc.function.name:
                        tool_calls_acc[idx]["name"] = tc.function.name
                    if tc.function and tc.function.arguments:
                        tool_calls_acc[idx]["arguments"] += tc.function.arguments

        _log_tokens(self.agent_type, usage, finish_reason, kwargs.get("max_tokens"))
        self._last_usage = usage
        self._last_tool_calls = list(tool_calls_acc.values())
        self._last_raw = "".join(full_parts)
        self._last_finish_reason = finish_reason
        if not self._last_raw.strip():
            logger.error(
                "Empty LLM content agent=%s finish_reason=%s usage=%s",
                self.agent_type,
                finish_reason,
                usage,
            )
        return "".join(full_parts), usage

    def complete_llm(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> tuple[Any, str, dict[str, int]]:
        """Non-streaming completion — preferred for structured JSON agents."""
        client = get_llm_client()
        kwargs: dict[str, Any] = {
            "model": MODEL,
            "messages": messages,
            "temperature": temperature,
            "extra_body": _kimi_no_thinking_body(),
        }
        cap = max_tokens or _max_tokens_for(self.agent_type, self.structured_output)
        if cap:
            kwargs["max_tokens"] = cap
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        elif self.structured_output:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            response = _create_chat_completion(client, kwargs)
        except Exception as exc:
            if _is_credit_limit_error(exc):
                raise
            logger.warning("complete_llm with extras failed (%s); retry no-thinking only", exc)
            kwargs.pop("response_format", None)
            kwargs["extra_body"] = _kimi_no_thinking_body()
            response = _create_chat_completion(client, kwargs)

        # Some OpenRouter / model responses return choices=None (or empty).
        if not getattr(response, "choices", None):
            logger.warning(
                "complete_llm empty choices agent=%s; retrying without response_format",
                self.agent_type,
            )
            kwargs.pop("response_format", None)
            kwargs["extra_body"] = _kimi_no_thinking_body()
            response = _create_chat_completion(client, kwargs)

        if not getattr(response, "choices", None):
            logger.warning(
                "complete_llm still empty choices agent=%s; falling back to stream_llm",
                self.agent_type,
            )
            # Reuse stream_llm path (already guards empty choices per chunk).
            gen = self.stream_llm(messages, tools=tools)
            content_parts: list[str] = []
            try:
                while True:
                    token = next(gen)
                    content_parts.append(token)
            except StopIteration as stop:
                streamed = "".join(content_parts)
                usage = self._last_usage or {
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "total_tokens": 0,
                }
                if stop.value and isinstance(stop.value, tuple) and len(stop.value) >= 2:
                    streamed = stop.value[0] or streamed
                    usage = stop.value[1] or usage
                if not streamed.strip():
                    raise RuntimeError(
                        f"LLM returned no choices and empty stream for agent={self.agent_type}"
                    )

                class _Msg:
                    content = streamed

                logger.info(
                    "complete_llm agent=%s finish=%s content_len=%s via_stream_fallback=1",
                    self.agent_type,
                    self._last_finish_reason,
                    len(streamed),
                )
                return _Msg(), streamed, usage

        message = response.choices[0].message
        content = message.content or ""
        usage = {
            "input_tokens": getattr(response.usage, "prompt_tokens", 0) or 0,
            "output_tokens": getattr(response.usage, "completion_tokens", 0) or 0,
            "total_tokens": getattr(response.usage, "total_tokens", 0) or 0,
        }
        details = getattr(response.usage, "completion_tokens_details", None)
        reasoning_tokens = getattr(details, "reasoning_tokens", None) if details else None
        logger.info(
            "complete_llm agent=%s finish=%s content_len=%s reasoning_tokens=%s",
            self.agent_type,
            response.choices[0].finish_reason,
            len(content),
            reasoning_tokens,
        )
        self._last_finish_reason = response.choices[0].finish_reason
        _log_tokens(self.agent_type, usage, self._last_finish_reason, kwargs.get("max_tokens"))
        return message, content, usage

    def complete_untruncated(
        self,
        messages: list[dict[str, Any]],
        temperature: float = 0.2,
    ) -> tuple[Any, str, dict[str, int]]:
        """complete_llm, retried once with a larger budget if the reply hit the token cap."""
        message, content, usage = self.complete_llm(
            messages, tools=None, temperature=temperature
        )
        if getattr(self, "_last_finish_reason", None) != "length":
            return message, content, usage
        base = _max_tokens_for(self.agent_type, self.structured_output)
        if not base:
            logger.error("Reply hit the model's own output limit agent=%s", self.agent_type)
            return message, content, usage
        bigger = min(base * 2, int(os.getenv("AGENT_MAX_TOKENS_CEILING", "6000")))
        logger.warning(
            "Reply truncated agent=%s at %s tokens; retrying with %s",
            self.agent_type,
            base,
            bigger,
        )
        message, content, usage2 = self.complete_llm(
            messages, tools=None, temperature=temperature, max_tokens=bigger
        )
        usage = {k: usage.get(k, 0) + usage2.get(k, 0) for k in usage}
        if getattr(self, "_last_finish_reason", None) == "length":
            logger.error("Reply still truncated agent=%s after retry", self.agent_type)
        return message, content, usage

    def stream_with_continuation(
        self, messages: list[dict[str, Any]], max_continuations: int = 2
    ) -> Generator[str, None, None]:
        """Stream a reply; if it stops at the token cap, ask the model to carry on."""
        full = ""
        total = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        convo = list(messages)
        sep = ""
        for attempt in range(max_continuations + 1):
            self._last_raw = ""
            self._last_finish_reason = None
            for token in self.stream_llm(convo):
                yield token
            part = getattr(self, "_last_raw", "") or ""
            used = getattr(self, "_last_usage", None) or {}
            total = {k: total.get(k, 0) + used.get(k, 0) for k in total}
            full = _join_continuation(full, part, sep) if attempt else part
            if getattr(self, "_last_finish_reason", None) != "length" or not part.strip():
                break
            if attempt == max_continuations:
                logger.error("Reply still truncated agent=%s after continuations", self.agent_type)
                break
            logger.warning(
                "Reply truncated agent=%s; continuing (%s/%s)",
                self.agent_type,
                attempt + 1,
                max_continuations,
            )
            full, sep = _drop_partial_word(full)
            tail = " ".join(full.split()[-14:])
            convo = [
                *messages,
                {"role": "assistant", "content": full.rstrip()},
                {
                    "role": "user",
                    "content": (
                        "Your previous message was cut off right after: "
                        f"\u201c{tail}\u201d. Continue with the very next word, with no "
                        "preamble and without repeating anything already written. Finish "
                        "your thought and end naturally."
                    ),
                },
            ]
        self._last_raw = full
        self._last_usage = total

    def generate_structured(
        self, messages: list[dict[str, Any]]
    ) -> Generator[str, None, tuple[str, dict[str, int]]]:
        """Non-stream generate JSON, then yield chunks for SSE UX."""
        _, content, usage = self.complete_untruncated(messages)
        self._last_raw = content
        self._last_usage = usage
        # Fake-stream for frontend
        step = 48
        for i in range(0, len(content), step):
            yield content[i : i + step]
        return content, usage

    def generate_judged(
        self,
        messages: list[dict[str, Any]],
        *,
        user_input: str,
        chat_history: list[dict[str, str]] | None,
        avatar_memory: list[dict[str, Any]] | None,
        profile: dict[str, Any] | None,
    ) -> Generator[dict[str, Any], None, None]:
        """Generate, judge draft/plan output, retry once with the rejection reason, then stream."""
        from services import draft_judge

        _, raw, usage = self.complete_untruncated(messages)
        review: dict[str, Any] = {"outcome": "not_judged", "attempts": 1, "verdicts": []}

        def _parse(text: str) -> dict[str, Any] | None:
            try:
                parsed = self.parse_output(text)
            except Exception:
                return None
            return strip_asterisks(parsed) if isinstance(parsed, dict) else None

        parsed = _parse(raw)
        missing_draft = parsed is not None and draft_judge.expects_draft(
            user_input, self.agent_type, parsed
        )
        too_long = draft_judge.length_violation(self.agent_type, parsed)
        if parsed is not None and (missing_draft or too_long or draft_judge.is_judged(parsed)):
            client = get_llm_client()
            facts = draft_judge.build_facts(user_input, chat_history, avatar_memory, profile)
            if missing_draft:
                verdict = dict(draft_judge.MISSING_DRAFT_VERDICT)
            elif too_long:
                verdict = draft_judge.length_verdict(too_long)
            else:
                verdict = draft_judge.judge_output(client, user_input, parsed, facts)
            review["verdicts"].append(verdict)
            review["outcome"] = "passed"
            if not verdict["pass"]:
                logger.info("draft rejected agent=%s reason=%s", self.agent_type, verdict.get("reason"))
                yield {"event": "status", "data": {"stage": "revising", "agent": self.agent_type}}
                retry_messages = draft_judge.build_retry_messages(messages, raw, verdict)
                _, raw2, usage2 = self.complete_untruncated(retry_messages, temperature=0.7)
                usage = {k: usage.get(k, 0) + usage2.get(k, 0) for k in usage}
                review["attempts"] = 2
                parsed2 = _parse(raw2)
                if parsed2 is None:
                    review["outcome"] = "fallback"
                    review["fallback_verdict"] = verdict
                else:
                    raw = raw2
                    still_long = draft_judge.length_violation(self.agent_type, parsed2)
                    if still_long:
                        review["outcome"] = "fallback"
                        review["fallback_verdict"] = draft_judge.length_verdict(still_long)
                    elif missing_draft and not draft_judge.is_judged(parsed2):
                        review["outcome"] = "no_draft_after_retry"
                    elif draft_judge.is_judged(parsed2):
                        verdict2 = draft_judge.judge_output(client, user_input, parsed2, facts)
                        review["verdicts"].append(verdict2)
                        if verdict2["pass"]:
                            review["outcome"] = "passed_after_retry"
                        else:
                            review["outcome"] = "fallback"
                            review["fallback_verdict"] = verdict2
                    else:
                        review["outcome"] = "passed_after_retry"

        for i in range(0, len(raw), 48):
            yield {"event": "token", "data": {"token": strip_asterisks(raw[i : i + 48])}}
        self._last_raw = raw
        self._last_usage = usage
        self._last_review = review

    def run_playbook_with_tools(
        self, user_input: str, messages: list[dict[str, Any]]
    ) -> tuple[str, dict[str, int], list[str]]:
        """Playbook-only: LLM decides WHEN to call MCP tools."""
        tool_names = ["fetch_playbooks", "similarity_search"]
        tools = self.mcp.openai_tool_schemas(tool_names)
        tools_used: list[str] = []
        total_usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

        message, content, usage = self.complete_llm(messages, tools=tools)
        for k in total_usage:
            total_usage[k] += usage[k]

        if not getattr(message, "tool_calls", None):
            return content, total_usage, tools_used

        # Execute tool calls
        messages.append(
            {
                "role": "assistant",
                "content": message.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in message.tool_calls
                ],
            }
        )

        for tc in message.tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"Playbook agent tool call had invalid JSON arguments: {tc.function.arguments}"
                ) from exc
            result = self.mcp.call_tool_json(name, args)
            tools_used.append(name)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                }
            )

        # Final streaming-friendly non-stream completion with JSON instruction
        messages.append(
            {
                "role": "user",
                "content": (
                    "Using the tool results, produce the final JSON response now. "
                    "No markdown fences."
                ),
            }
        )
        _, final_content, usage2 = self.complete_llm(messages, tools=None)
        for k in total_usage:
            total_usage[k] += usage2[k]
        return final_content, total_usage, tools_used

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
    ) -> Generator[dict[str, Any], None, None]:
        """Execute the agent pipeline, yielding SSE-ready event dicts."""
        agent_type = agent_type or self.agent_type
        status = "success"
        error_message = None
        raw_response = ""
        parsed: Any = None
        context: dict[str, Any] = {}
        usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
        tools_used: list[str] = []
        previous_performance: list[dict[str, Any]] = []
        tool_trace: list[dict[str, Any]] = []
        review: dict[str, Any] | None = None
        TOOL_TRACE.set(tool_trace)

        # If user supplied ingested competitor intel, keep chatbot context on
        if competitor_summaries and agent_type == "chatbot":
            chatbot_context_on = True

        try:
            yield {"event": "status", "data": {"stage": "fetching_context", "agent": agent_type}}

            from context.avatar_context import build_avatar_context
            from context.avatar_resolve import resolve_avatar_ids
            from constants import normalize_response_language

            try:
                response_language = normalize_response_language(response_language)
            except ValueError as lang_error:
                raise ValueError(str(lang_error)) from lang_error

            has_tagged_avatars = bool(
                tagged_avatar_ids
                and any(str(item).strip() for item in tagged_avatar_ids)
            )
            if has_tagged_avatars:
                chatbot_context_on = True

            avatar_ids = resolve_avatar_ids(
                user_id=user_id,
                avatar_id=avatar_id,
                tagged_avatar_ids=tagged_avatar_ids,
            )

            avatar_bundle: dict[str, Any] | None = None
            if avatar_ids and (
                chatbot_context_on
                or has_tagged_avatars
                or len(avatar_ids) > 1
                or agent_type in {"linkedin", "instagram", "twitter"}
                or competitor_summaries
            ):
                avatar_bundle = build_avatar_context(
                    user_id=user_id,
                    avatar_ids=avatar_ids,
                    user_input=user_input,
                    agent_type=agent_type,
                )
                tools_used = list(avatar_bundle.get("tools_used") or [])

            # Avoid a second full RAG pass when avatar_bundle already loaded profile +
            # competitor intel (was roughly doubling pre-LLM latency).
            needs_legacy_gather = (
                agent_type == "playbook"
                or live_mode
                or bool(competitor_summaries)
                or (
                    agent_type == "chatbot"
                    and chatbot_context_on
                    and not avatar_bundle
                )
                or (
                    agent_type in {"linkedin", "instagram", "twitter"}
                    and not avatar_bundle
                )
            )
            if needs_legacy_gather:
                gathered = self.select_tools(
                    user_id=user_id,
                    avatar_id=avatar_ids[0] if avatar_ids else avatar_id,
                    user_input=user_input,
                    live_mode=live_mode,
                    chatbot_context_on=chatbot_context_on and not avatar_bundle,
                    competitor_url=competitor_url,
                    competitor_summaries=competitor_summaries,
                )
            else:
                gathered = {
                    "profile": None,
                    "summaries": [],
                    "playbooks": [],
                    "similar": [],
                    "scrape_result": None,
                    "tools_used": [],
                }

            # The demo corpus is global strategy reference material. Retrieve it
            # through MCP and present it in the same compact evidence slot as a
            # playbook, while retaining source/section metadata for traceability.
            if agent_type in {"instagram", "linkedin", "twitter", "playbook"} or (
                agent_type == "chatbot" and chatbot_context_on
            ):
                knowledge_hits = self.mcp.call_tool(
                    "similarity_search",
                    {
                        "query_text": user_input[:500],
                        "table": "marketing_knowledge_chunks",
                        "top_k": 3,
                        "avatar_id": avatar_id,
                        "user_id": user_id,
                    },
                )
                transcript_lessons = [
                    hit.get("content")
                    for hit in knowledge_hits
                    if isinstance(hit, dict) and isinstance(hit.get("content"), dict)
                ]
                if transcript_lessons:
                    gathered["transcript_lessons"] = [
                        *list(gathered.get("transcript_lessons") or []),
                        *transcript_lessons,
                    ]
                    tools_used.append("similarity_search:marketing_knowledge_chunks")
            for tool_name in gathered.get("tools_used") or []:
                if tool_name not in tools_used:
                    tools_used.append(tool_name)

            avatar_memory: list[dict[str, Any]] = []
            memory_avatar_id = avatar_ids[0] if avatar_ids else avatar_id
            if agent_type in STRATEGIST_AGENTS and memory_avatar_id:
                from services.avatar_memory import load_avatar_memory

                avatar_memory = load_avatar_memory(
                    user_id=user_id, avatar_id=memory_avatar_id
                )
                if avatar_memory:
                    tools_used.append("avatar_memory")

            competitor_style: dict[str, Any] | None = None
            if agent_type in {"linkedin", "instagram"} and memory_avatar_id:
                from services.competitor_style import load_competitor_post_style

                competitor_style = load_competitor_post_style(
                    avatar_id=memory_avatar_id, platform=agent_type
                )
                if competitor_style:
                    tools_used.append("competitor_post_style")

            if agent_type == "instagram":
                from services.content_plan import load_recent_content_performance

                previous_performance = load_recent_content_performance(
                    user_id=user_id,
                    avatar_id=avatar_ids[0] if avatar_ids else avatar_id,
                )

            profile = (
                (avatar_bundle or {}).get("profile")
                or (
                    (avatar_bundle or {}).get("profiles") or [None]
                )[0]
                or gathered.get("profile")
            )
            summaries = (
                (avatar_bundle or {}).get("summaries")
                or gathered.get("summaries")
                or []
            )
            if competitor_summaries:
                # Merge ingested summaries into competitor intel
                for item in competitor_summaries:
                    if isinstance(item, dict) and item.get("summary"):
                        s = dict(item["summary"])
                        s.setdefault("competitor_url", item.get("url"))
                        s.setdefault("competitor_handle", item.get("handle"))
                        s.setdefault("platform", item.get("platform"))
                        summaries.append(s)

            context = assemble_context(
                profile=profile,
                summaries=summaries,
                playbooks=gathered.get("playbooks"),
                user_input=user_input,
                agent_type=agent_type,
                avatar_bundle=avatar_bundle,
                transcript_lessons=gathered.get("transcript_lessons"),
                previous_performance=previous_performance,
                avatar_memory=avatar_memory,
                competitor_post_style=competitor_style,
            )

            system_prompt = get_system_prompt(
                agent_type,
                chatbot_context_on,
                multi_avatar=bool(avatar_bundle and avatar_bundle.get("multi_avatar")),
            )
            system_prompt += response_language_instruction(
                response_language,
                structured=bool(self.structured_output),
            )
            messages = self.build_messages(
                system_prompt,
                context,
                user_input,
                chatbot_context_on,
                chat_history=chat_history,
                response_language=response_language,
            )

            yield {
                "event": "status",
                "data": {
                    "stage": "context_evaluated",
                    "agent": agent_type,
                    "evaluation": {
                        "tool_calls": tool_trace,
                        "tool_call_count": len(tool_trace),
                        "total_tool_ms": round(
                            sum(float(item.get("duration_ms") or 0) for item in tool_trace),
                            1,
                        ),
                        "avatar_profile": {
                            "loaded": bool(profile),
                            "avatar_count": len((avatar_bundle or {}).get("profiles") or []),
                        },
                        "competitor_rag": {
                            "items": len(summaries),
                            "source": "instagram_content_summaries"
                            if agent_type == "instagram"
                            else "avatar_competitor_context",
                        },
                        "transcript_rag": {
                            "items": len(context.get("transcript_lessons") or []),
                            "source": "marketing_knowledge_chunks",
                        },
                        "playbook_rag": {
                            "items": len(context.get("relevant_playbooks") or []),
                            "source": "playbooks",
                        },
                        "previous_performance": {
                            "items": len(previous_performance),
                            "used": bool(previous_performance),
                        },
                    },
                },
            }

            yield {
                "event": "status",
                "data": {
                    "stage": "calling_llm",
                    "agent": agent_type,
                    "tools_used": tools_used,
                    "model": MODEL,
                },
            }

            if agent_type == "playbook":
                # Tool calling decides WHEN to fetch rules
                raw_response, usage, playbook_tools = self.run_playbook_with_tools(
                    user_input, messages
                )
                tools_used.extend(playbook_tools)
                for i in range(0, len(raw_response), 48):
                    yield {"event": "token", "data": {"token": raw_response[i : i + 48]}}
            elif self.structured_output and agent_type in STRATEGIST_AGENTS:
                self._last_usage = usage
                self._last_raw = ""
                self._last_review = None
                yield from self.generate_judged(
                    messages,
                    user_input=user_input,
                    chat_history=chat_history,
                    avatar_memory=avatar_memory,
                    profile=profile,
                )
                raw_response = getattr(self, "_last_raw", "") or ""
                usage = getattr(self, "_last_usage", usage)
                review = getattr(self, "_last_review", None)
            elif self.structured_output:
                # Non-stream JSON generation — Kimi thinking mode empties streamed content
                self._last_usage = usage
                self._last_raw = ""
                for token in self.generate_structured(messages):
                    yield {
                        "event": "token",
                        "data": {"token": strip_asterisks(token)},
                    }
                raw_response = getattr(self, "_last_raw", "") or ""
                usage = getattr(self, "_last_usage", usage)
            else:
                self._last_usage = usage
                self._last_raw = ""
                for token in self.stream_with_continuation(messages):
                    yield {
                        "event": "token",
                        "data": {"token": strip_asterisks(token)},
                    }
                raw_response = getattr(self, "_last_raw", "") or ""
                usage = getattr(self, "_last_usage", usage)

            try:
                if not (raw_response or "").strip():
                    raise ValueError(
                        "Empty model response — Kimi returned no content "
                        f"(finish_reason={getattr(self, '_last_finish_reason', None)})"
                    )
                parsed = self.parse_output(raw_response)
            except Exception as parse_exc:
                logger.error("Parse error agent=%s: %s", agent_type, parse_exc)
                status = "parse_error"
                error_message = str(parse_exc)
                parsed = self._fallback_output(f"JSON parse failed: {parse_exc}")
                if self.structured_output and isinstance(parsed, dict):
                    parsed["raw_response_excerpt"] = (raw_response or "")[:4000]
                    # Let UI still show whatever streamed
                    parsed["display_text"] = raw_response or ""
                elif not self.structured_output:
                    parsed = raw_response or parsed

            parsed = strip_asterisks(parsed)

            if review and isinstance(parsed, dict):
                if review.get("outcome") == "passed_after_retry":
                    tools_used.append("draft_judge_retry")
                elif review.get("outcome") == "fallback":
                    from services.draft_judge import apply_fallback

                    review["fallback"] = apply_fallback(parsed, review.get("fallback_verdict") or {})
                    tools_used.append("draft_judge_fallback")
                elif review.get("outcome") == "passed":
                    tools_used.append("draft_judge")

            if agent_type in STRATEGIST_AGENTS and isinstance(parsed, dict):
                try:
                    from services.draft_grounding import (
                        build_allowed_text,
                        filter_memory_updates,
                        strip_unsupported_quotes,
                    )

                    allowed_norm = build_allowed_text(
                        user_input, chat_history, avatar_memory
                    )
                    if strip_unsupported_quotes(parsed, allowed_norm):
                        tools_used.append("draft_grounding")
                    parsed["memory_updates"] = filter_memory_updates(
                        parsed.get("memory_updates"), allowed_norm
                    )
                except Exception as guard_error:
                    logger.warning("Draft grounding guard failed: %s", guard_error)

                try:
                    from services.avatar_memory import save_memory_updates

                    saved_memory = save_memory_updates(
                        user_id=user_id,
                        avatar_id=avatar_ids[0] if avatar_ids else avatar_id,
                        platform=agent_type,
                        updates=parsed.get("memory_updates"),
                    )
                    if saved_memory:
                        tools_used.append("avatar_memory_write")
                except Exception as memory_error:
                    logger.warning("Avatar memory write failed: %s", memory_error)

            if agent_type == "instagram" and isinstance(parsed, dict):
                try:
                    from services.content_plan import (
                        persist_instagram_content_plan_items,
                    )

                    persisted_items = persist_instagram_content_plan_items(
                        user_id=user_id,
                        avatar_id=avatar_ids[0] if avatar_ids else avatar_id,
                        output=parsed,
                    )
                    if persisted_items:
                        tools_used.append("content_plan_items")
                        item_ids = [
                            item.get("id")
                            for item in persisted_items
                            if item.get("id")
                        ]
                        parsed["content_plan_item_ids"] = item_ids
                        calendar = parsed.get("content_calendar")
                        if isinstance(calendar, list):
                            for item, item_id in zip(calendar, item_ids):
                                if isinstance(item, dict):
                                    item["content_plan_item_id"] = item_id
                except Exception as persist_error:
                    logger.warning(
                        "Instagram content plan persistence failed: %s",
                        persist_error,
                    )

            yield {
                "event": "complete",
                "data": {
                    "agent": agent_type,
                    "output": parsed,
                    "usage": usage,
                    "tools_used": tools_used,
                    "status": status,
                    "review": review,
                },
            }

        except Exception as exc:
            logger.exception("Agent run failed agent_type=%s", agent_type)
            status = "error"
            error_message = str(exc)
            parsed = self._fallback_output(error_message)
            yield {
                "event": "error",
                "data": {
                    "agent": agent_type,
                    "error": error_message,
                    "output": parsed,
                },
            }

        finally:
            payload = {
                "user_id": user_id,
                "avatar_id": avatar_id,
                "agent_type": agent_type,
                "user_input": user_input,
                "context_snapshot": {
                    **context,
                    "tools_used": tools_used,
                    "chatbot_context_on": chatbot_context_on,
                    "live_mode": live_mode,
                },
                "raw_response": raw_response,
                "parsed_output": parsed if isinstance(parsed, dict) else {"text": parsed},
                "model_used": MODEL,
                "input_tokens": usage.get("input_tokens"),
                "output_tokens": usage.get("output_tokens"),
                "total_tokens": usage.get("total_tokens"),
                "status": status,
                "error_message": error_message,
            }
            # Don't block SSE close on Supabase logging
            threading.Thread(
                target=log_agent_call, args=(payload,), daemon=True
            ).start()
