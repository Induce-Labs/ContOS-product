"""In-process MCP server — tool registry agents use for all data fetching.

Agents never query Supabase directly; they call tools through this server.
"""

from __future__ import annotations

import json
import logging
import re
import time
from contextvars import ContextVar
from typing import Any, Callable

from mcp.tools import (
    fetch_playbooks,
    fetch_profile,
    fetch_summaries,
    scrape_competitor,
    similarity_search,
)

logger = logging.getLogger(__name__)

TOOL_TRACE: ContextVar[list[dict[str, Any]] | None] = ContextVar(
    "contos_tool_trace", default=None
)

ToolHandler = Callable[..., Any]

_ANALYSIS_INTENT_RE = re.compile(
    r"\b("
    r"compare|comparison|contrast|versus|vs\.?|differen\w*|"
    r"analy[sz]e|analysis|insights?|"
    r"what\s+(are|is)\s+(my\s+)?competitors?|"
    r"how\s+(do|does|are)\s+(my\s+)?competitors?|"
    r"competitors?\s+in\s+(the\s+)?(database|db|table)"
    r")\b",
    re.I,
)


def _is_analysis_intent(text: str) -> bool:
    return bool(_ANALYSIS_INTENT_RE.search(text or ""))


class MCPServer:
    """Lightweight MCP-compatible tool orchestrator."""

    def __init__(self) -> None:
        self._tools: dict[str, dict[str, Any]] = {}
        self._register_defaults()

    def _register_defaults(self) -> None:
        self.register(
            name="fetch_profile",
            description="Fetch the user's brand profile from Supabase avatars.profiling_data.",
            parameters={
                "type": "object",
                "properties": {
                    "user_id": {"type": "string", "description": "User UUID"},
                    "avatar_id": {
                        "type": "string",
                        "description": "Optional project UUID to resolve brand name/type",
                    },
                },
                "required": ["user_id"],
            },
            handler=fetch_profile,
        )
        self.register(
            name="fetch_summaries",
            description="Fetch competitor content summaries for one owned project (optional platform filter).",
            parameters={
                "type": "object",
                "properties": {
                    "avatar_id": {"type": "string"},
                    "platform": {
                        "type": "string",
                        "enum": ["instagram", "linkedin", "twitter"],
                    },
                    "user_id": {
                        "type": "string",
                        "description": "Authenticated user UUID for ownership checks",
                    },
                },
                "required": ["avatar_id"],
            },
            handler=fetch_summaries,
        )
        self.register(
            name="similarity_search",
            description=(
                "Agentic RAG retrieve: embed a query and return top-k similar playbooks, "
                "source-grounded marketing knowledge chunks, "
                "LinkedIn summaries (linkedin_content_summaries), or Instagram summaries "
                "(instagram_content_summaries)."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "query_text": {"type": "string"},
                    "table": {
                        "type": "string",
                        "enum": [
                            "playbooks",
                            "marketing_knowledge_chunks",
                            "linkedin_content_summaries",
                            "instagram_content_summaries",
                        ],
                        "default": "playbooks",
                    },
                    "top_k": {"type": "integer", "default": 5},
                    "avatar_id": {
                        "type": "string",
                        "description": "Required project filter for summary RAG",
                    },
                    "user_id": {
                        "type": "string",
                        "description": "Authenticated user UUID for ownership checks",
                    },
                    "platform": {
                        "type": "string",
                        "enum": ["instagram", "linkedin"],
                        "description": "Platform filter for instagram_content_summaries (default instagram)",
                    },
                    "fast": {
                        "type": "boolean",
                        "default": False,
                        "description": "If true, skip embedding API and lexically rank DB rows",
                    },
                },
                "required": ["query_text"],
            },
            handler=similarity_search,
        )
        self.register(
            name="scrape_competitor",
            description="Resolve competitor intelligence from Supabase summaries within one project.",
            parameters={
                "type": "object",
                "properties": {
                    "competitor_url": {"type": "string"},
                    "platform": {
                        "type": "string",
                        "enum": ["instagram", "linkedin", "twitter"],
                    },
                    "avatar_id": {"type": "string"},
                    "user_id": {"type": "string"},
                },
                "required": ["competitor_url", "platform", "avatar_id"],
            },
            handler=scrape_competitor,
        )
        self.register(
            name="fetch_playbooks",
            description="Fetch Fortune 500 strategy playbook rules, optionally filtered by category.",
            parameters={
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Optional category filter e.g. Outbound, Brand Guardrails",
                    }
                },
                "required": [],
            },
            handler=fetch_playbooks,
        )

    def register(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any],
        handler: ToolHandler,
    ) -> None:
        self._tools[name] = {
            "name": name,
            "description": description,
            "parameters": parameters,
            "handler": handler,
        }

    def list_tools(self) -> list[dict[str, Any]]:
        return [
            {
                "name": t["name"],
                "description": t["description"],
                "inputSchema": t["parameters"],
            }
            for t in self._tools.values()
        ]

    def openai_tool_schemas(self, names: list[str] | None = None) -> list[dict[str, Any]]:
        """OpenAI/OpenRouter function-calling schemas for selected tools."""
        selected = names or list(self._tools.keys())
        schemas: list[dict[str, Any]] = []
        for name in selected:
            tool = self._tools[name]
            schemas.append(
                {
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool["description"],
                        "parameters": tool["parameters"],
                    },
                }
            )
        return schemas

    def call_tool(self, name: str, arguments: dict[str, Any] | None = None) -> Any:
        if name not in self._tools:
            raise KeyError(f"Unknown MCP tool: {name}")
        args = arguments or {}
        logger.info("MCP tool call name=%s args=%s", name, args)
        handler = self._tools[name]["handler"]
        started = time.perf_counter()
        try:
            result = handler(**args)
        except Exception as exc:
            trace = TOOL_TRACE.get()
            if trace is not None:
                trace.append(
                    {
                        "tool": name,
                        "table": args.get("table"),
                        "top_k": args.get("top_k"),
                        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                        "status": "error",
                        "error_type": type(exc).__name__,
                    }
                )
            raise
        trace = TOOL_TRACE.get()
        if trace is not None:
            trace.append(
                {
                    "tool": name,
                    "table": args.get("table"),
                    "top_k": args.get("top_k"),
                    "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                    "status": "ok",
                    "result_count": len(result) if isinstance(result, list) else None,
                }
            )
        return result

    def call_tool_json(self, name: str, arguments: dict[str, Any] | None = None) -> str:
        result = self.call_tool(name, arguments)
        return json.dumps(result, default=str)

    # ------------------------------------------------------------------
    # Agent-type tool routing (deterministic pre-fetch)
    # ------------------------------------------------------------------

    def gather_for_agent(
        self,
        agent_type: str,
        user_id: str,
        avatar_id: str,
        user_input: str,
        live_mode: bool = False,
        chatbot_context_on: bool = False,
        competitor_url: str | None = None,
        competitor_summaries: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Decide which tools to call based on agent_type and return payload."""
        profile: dict[str, Any] | None = None
        summaries: list[dict[str, Any]] = []
        playbooks: list[dict[str, Any]] = []
        similar: list[dict[str, Any]] = []
        scrape_result: dict[str, Any] | None = None
        tools_used: list[str] = []

        # User-ingested competitor knowledge base (from /api/competitors/ingest)
        ingested: list[dict[str, Any]] = []
        for item in competitor_summaries or []:
            if isinstance(item, dict) and item.get("summary"):
                s = dict(item["summary"])
                s.setdefault("competitor_url", item.get("url"))
                s.setdefault("competitor_handle", item.get("handle"))
                s.setdefault("platform", item.get("platform"))
                s["source"] = item.get("source") or s.get("source") or "ingested"
                ingested.append(s)
            elif isinstance(item, dict) and (
                item.get("strategic_signals") or item.get("recurring_hooks_patterns")
            ):
                ingested.append(item)

        if agent_type == "chatbot" and not chatbot_context_on and not ingested:
            return {
                "profile": None,
                "summaries": [],
                "playbooks": [],
                "similar": [],
                "scrape_result": None,
                "tools_used": [],
                "context_mode": "off",
            }

        if agent_type == "linkedin":
            profile = self.call_tool(
                "fetch_profile", {"user_id": user_id, "avatar_id": avatar_id}
            )
            tools_used.append("fetch_profile")
            # Agentic RAG: retrieve top LinkedIn summaries by query embedding
            similar_li = self.call_tool(
                "similarity_search",
                {
                    "query_text": user_input[:500],
                    "table": "linkedin_content_summaries",
                    "top_k": 3,
                    "avatar_id": avatar_id,
                    "user_id": user_id,
                },
            )
            tools_used.append("similarity_search:linkedin_content_summaries")
            summaries = [
                s.get("content")
                for s in similar_li
                if isinstance(s.get("content"), dict)
            ]
            # Fallback: full project LinkedIn summaries if vectors empty
            if not summaries:
                summaries = self.call_tool(
                    "fetch_summaries",
                    {
                        "avatar_id": avatar_id,
                        "platform": "linkedin",
                        "user_id": user_id,
                    },
                )
                tools_used.append("fetch_summaries")
            platform_ingested = [
                s
                for s in ingested
                if (s.get("platform") or "").lower() == "linkedin"
            ]
            if platform_ingested:
                summaries = platform_ingested + list(summaries)
            similar = self.call_tool(
                "similarity_search",
                {
                    "query_text": user_input[:500],
                    "table": "playbooks",
                    "top_k": 3,
                    "avatar_id": avatar_id,
                },
            )
            tools_used.append("similarity_search:playbooks")
            playbooks = [s.get("content") for s in similar if s.get("content")]
            if live_mode and competitor_url:
                scrape_result = self.call_tool(
                    "scrape_competitor",
                    {
                        "competitor_url": competitor_url,
                        "platform": "linkedin",
                        "avatar_id": avatar_id,
                        "user_id": user_id,
                    },
                )
                tools_used.append("scrape_competitor")
                if scrape_result.get("summary"):
                    summaries = [scrape_result["summary"], *summaries]

        elif agent_type == "instagram":
            profile = self.call_tool(
                "fetch_profile", {"user_id": user_id, "avatar_id": avatar_id}
            )
            tools_used.append("fetch_profile")
            analysis_mode = _is_analysis_intent(user_input)
            if analysis_mode:
                # Load all Instagram summaries for THIS project only (multi-competitor compare)
                summaries = self.call_tool(
                    "fetch_summaries",
                    {
                        "avatar_id": avatar_id,
                        "platform": "instagram",
                        "user_id": user_id,
                    },
                )
                tools_used.append("fetch_summaries:instagram")
            else:
                similar_ig = self.call_tool(
                    "similarity_search",
                    {
                        "query_text": user_input[:500],
                        "table": "instagram_content_summaries",
                        "platform": "instagram",
                        "top_k": 3,
                        "avatar_id": avatar_id,
                        "user_id": user_id,
                    },
                )
                tools_used.append("similarity_search:instagram_content_summaries")
                summaries = [
                    s.get("content")
                    for s in similar_ig
                    if isinstance(s.get("content"), dict)
                ]
                if not summaries:
                    summaries = self.call_tool(
                        "fetch_summaries",
                        {
                            "avatar_id": avatar_id,
                            "platform": "instagram",
                            "user_id": user_id,
                        },
                    )
                    tools_used.append("fetch_summaries")
            platform_ingested = [
                s
                for s in ingested
                if (s.get("platform") or "").lower() == "instagram"
            ]
            if platform_ingested:
                summaries = platform_ingested + list(summaries)
            similar = self.call_tool(
                "similarity_search",
                {
                    "query_text": user_input[:500],
                    "table": "playbooks",
                    "top_k": 3,
                    "avatar_id": avatar_id,
                },
            )
            tools_used.append("similarity_search:playbooks")
            playbooks = [s.get("content") for s in similar if s.get("content")]
            if live_mode and competitor_url and not analysis_mode:
                scrape_result = self.call_tool(
                    "scrape_competitor",
                    {
                        "competitor_url": competitor_url,
                        "platform": "instagram",
                        "avatar_id": avatar_id,
                        "user_id": user_id,
                    },
                )
                tools_used.append("scrape_competitor")
                if scrape_result.get("summary"):
                    summaries = [scrape_result["summary"], *summaries]

        elif agent_type == "chatbot" and (chatbot_context_on or ingested):
            profile = self.call_tool(
                "fetch_profile", {"user_id": user_id, "avatar_id": avatar_id}
            )
            tools_used.append("fetch_profile")
            if ingested:
                summaries = list(ingested)
                tools_used.append("competitor_knowledge_base")
            else:
                # Chat context ON → LinkedIn + Instagram RAG for this project
                similar_li = self.call_tool(
                    "similarity_search",
                    {
                        "query_text": user_input[:500],
                        "table": "linkedin_content_summaries",
                        "top_k": 2,
                        "avatar_id": avatar_id,
                        "user_id": user_id,
                    },
                )
                tools_used.append("similarity_search:linkedin_content_summaries")
                similar_ig = self.call_tool(
                    "similarity_search",
                    {
                        "query_text": user_input[:500],
                        "table": "instagram_content_summaries",
                        "platform": "instagram",
                        "top_k": 2,
                        "avatar_id": avatar_id,
                        "user_id": user_id,
                    },
                )
                tools_used.append("similarity_search:instagram_content_summaries")
                summaries = [
                    s.get("content")
                    for s in (similar_li + similar_ig)
                    if isinstance(s.get("content"), dict)
                ]
                if not summaries:
                    summaries = self.call_tool(
                        "fetch_summaries",
                        {"avatar_id": avatar_id, "user_id": user_id},
                    )
                    tools_used.append("fetch_summaries")

        elif agent_type == "playbook":
            pass

        return {
            "profile": profile,
            "summaries": summaries,
            "playbooks": playbooks,
            "similar": similar,
            "scrape_result": scrape_result,
            "tools_used": tools_used,
            "context_mode": (
                "on"
                if agent_type != "chatbot" or chatbot_context_on or ingested
                else "off"
            ),
        }


# Singleton used by agents
mcp_server = MCPServer()
