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

from context.assembly import assemble_context
from db.supabase_client import log_agent_call
from mcp.server import mcp_server
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
        max_retries=1,
    )


def _max_tokens_for(agent_type: str, structured: bool) -> int:
    if agent_type == "chatbot":
        return int(os.getenv("CHATBOT_MAX_TOKENS", "350"))
    if structured:
        return int(os.getenv("AGENT_MAX_TOKENS", "10000"))
    return 800


def strip_asterisks(value: Any) -> Any:
    """Remove * from agent-facing text (no markdown bold/italic)."""
    if value is None:
        return value
    if isinstance(value, str):
        return value.replace("*", "")
    if isinstance(value, list):
        return [strip_asterisks(v) for v in value]
    if isinstance(value, dict):
        return {k: strip_asterisks(v) for k, v in value.items()}
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
    ) -> list[dict[str, str]]:
        history = [turn for turn in (chat_history or []) if turn.get("content")]

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
            messages.append({"role": "user", "content": final_user_content})
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
                "\n\nCONVERSATION MEMORY (prior turns in this thread — "
                "stay consistent with what was already discussed):\n"
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
        if self.structured_output:
            user_content += (
                "\n\nRespond with valid JSON only matching the required schema. "
                "ANSWER THE USER REQUEST DIRECTLY. "
                "If they asked to compare/analyze competitors, use response_type "
                "competitor_comparison or analysis — do NOT invent a content calendar. "
                "Only generate a content calendar when they ask for posts/Reels/calendar. "
                "Include reasoning for every creative recommendation. Be concise. "
                "Never use asterisk (*) characters."
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
            "max_tokens": _max_tokens_for(self.agent_type, self.structured_output),
            "stream": True,
            "extra_body": _kimi_no_thinking_body(),
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        if self.structured_output and not tools:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            stream = client.chat.completions.create(**kwargs)
        except Exception as first_exc:
            logger.warning(
                "stream_llm with extras failed (%s); retry keeping no-thinking",
                first_exc,
            )
            kwargs.pop("response_format", None)
            kwargs["extra_body"] = _kimi_no_thinking_body()
            stream = client.chat.completions.create(**kwargs)

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
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None
    ) -> tuple[Any, str, dict[str, int]]:
        """Non-streaming completion — preferred for structured JSON agents."""
        client = get_llm_client()
        kwargs: dict[str, Any] = {
            "model": MODEL,
            "messages": messages,
            "temperature": 0.2,
            "max_tokens": _max_tokens_for(self.agent_type, self.structured_output),
            "extra_body": _kimi_no_thinking_body(),
        }
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        elif self.structured_output:
            kwargs["response_format"] = {"type": "json_object"}

        try:
            response = client.chat.completions.create(**kwargs)
        except Exception as exc:
            logger.warning("complete_llm with extras failed (%s); retry no-thinking only", exc)
            kwargs.pop("response_format", None)
            kwargs["extra_body"] = _kimi_no_thinking_body()
            response = client.chat.completions.create(**kwargs)

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
        return message, content, usage

    def generate_structured(
        self, messages: list[dict[str, Any]]
    ) -> Generator[str, None, tuple[str, dict[str, int]]]:
        """Non-stream generate JSON, then yield chunks for SSE UX."""
        _, content, usage = self.complete_llm(messages, tools=None)
        self._last_raw = content
        self._last_usage = usage
        # Fake-stream for frontend
        step = 48
        for i in range(0, len(content), step):
            yield content[i : i + step]
        return content, usage

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

        # If user supplied ingested competitor intel, keep chatbot context on
        if competitor_summaries and agent_type == "chatbot":
            chatbot_context_on = True

        try:
            yield {"event": "status", "data": {"stage": "fetching_context", "agent": agent_type}}

            from context.avatar_context import build_avatar_context
            from context.avatar_resolve import resolve_avatar_ids

            avatar_ids = resolve_avatar_ids(
                user_id=user_id,
                avatar_id=avatar_id,
                tagged_avatar_ids=tagged_avatar_ids,
            )

            avatar_bundle: dict[str, Any] | None = None
            if avatar_ids and (
                chatbot_context_on
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

            # Keep legacy gather for playbooks / live scrape / ingest merge
            gathered = self.select_tools(
                user_id=user_id,
                avatar_id=avatar_ids[0] if avatar_ids else avatar_id,
                user_input=user_input,
                live_mode=live_mode,
                chatbot_context_on=chatbot_context_on and not avatar_bundle,
                competitor_url=competitor_url,
                competitor_summaries=competitor_summaries,
            )
            for tool_name in gathered.get("tools_used") or []:
                if tool_name not in tools_used:
                    tools_used.append(tool_name)

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
            )

            system_prompt = get_system_prompt(
                agent_type,
                chatbot_context_on,
                multi_avatar=bool(avatar_bundle and avatar_bundle.get("multi_avatar")),
            )
            messages = self.build_messages(
                system_prompt,
                context,
                user_input,
                chatbot_context_on,
                chat_history=chat_history,
            )

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
                for token in self.stream_llm(messages):
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

            yield {
                "event": "complete",
                "data": {
                    "agent": agent_type,
                    "output": parsed,
                    "usage": usage,
                    "tools_used": tools_used,
                    "status": status,
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
