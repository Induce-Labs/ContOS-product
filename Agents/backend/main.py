"""ContOS Agents API — FastAPI entrypoint with SSE streaming."""

from __future__ import annotations

import json
import logging
import os
import queue
import secrets
import sys
import threading
import time
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Ensure backend/ is on sys.path for absolute imports (db, mcp, agents, ...)
BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from env_loader import load_agents_env  # noqa: E402

load_agents_env()

from agents import get_agent  # noqa: E402
from auth import (  # noqa: E402
    get_current_user_id,
    require_admin_user,
    verify_avatar_owner,
)
from chat_history import ChatHistoryTurn, normalize_chat_history  # noqa: E402
from embeddings.embed import (  # noqa: E402
    backfill_content_summary_embeddings,
    backfill_linkedin_summary_embeddings,
    store_playbooks_from_mock,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("contos.api")

app = FastAPI(
    title="ContOS Agents API",
    description="Specialized marketing agents with MCP tool orchestration (user-scoped)",
    version="0.3.0",
)

cors_origins = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:3000,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
]
# Always allow local Vite on both localhost and 127.0.0.1 (browsers treat them as different origins).
for _origin in (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
):
    if _origin not in cors_origins:
        cors_origins.append(_origin)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

AgentType = Literal["playbook", "instagram", "linkedin", "twitter", "chatbot"]


class InvokeRequest(BaseModel):
    avatar_id: str = Field(..., description="Avatar UUID owned by the authenticated user")
    agent_type: AgentType
    user_input: str = Field(..., min_length=1)
    live_mode: bool = False
    chatbot_context_on: bool = False
    competitor_url: str | None = None
    competitor_summaries: list[dict[str, Any]] | None = None
    tagged_avatar_ids: list[str] | None = Field(
        default=None,
        description="Optional Avatar IDs to include in strategy context",
    )
    chat_history: list[ChatHistoryTurn] | None = Field(
        default=None,
        description="Prior user/assistant turns in this thread (max 12 after normalize)",
    )
    response_language: str = Field(
        default="en",
        min_length=2,
        max_length=8,
        description="UI locale code; agent must reply in this language (en/hi/zh/fr/es)",
    )


class CompetitorIngestItem(BaseModel):
    url: str = Field(..., min_length=1)
    platform: str = Field(..., min_length=1)


class CompetitorIngestRequest(BaseModel):
    competitors: list[CompetitorIngestItem] = Field(..., min_length=1)
    avatar_id: str = Field(..., min_length=1)


class ProfileSummarizeRequest(BaseModel):
    avatar_id: str = Field(..., min_length=1)
    force: bool = False


class TranslateRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1)
    target_lang: str = Field(..., min_length=2, max_length=8)
    source_lang: str = Field(default="en", min_length=2, max_length=8)


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.get("/api/health")
def health(response: Response) -> dict[str, Any]:
    from env_loader import _SCRAPE_BACKEND_ENV, load_agents_env as _load
    from services.redis_health import ping_redis

    _load()
    scrape_env = _SCRAPE_BACKEND_ENV
    redis_ok = ping_redis()
    payload: dict[str, Any] = {
        "status": "ok" if redis_ok else "degraded",
        "service": "contos-agents",
        "redis": "up" if redis_ok else "down",
        "llm_model": os.getenv("LLM_MODEL", "moonshotai/kimi-k2.6"),
        "embedding_model": os.getenv(
            "EMBEDDING_MODEL", "openai/text-embedding-3-small"
        ),
        "embedding_provider": "openrouter",
        "llm_env": os.getenv("LLM_ENV", "dev"),
        "openrouter_configured": bool(os.getenv("OPENROUTER_API_KEY")),
        "supabase_configured": bool(
            os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        ),
        "scrape_env_found": scrape_env.is_file(),
        "scrape_env_bytes": scrape_env.stat().st_size if scrape_env.is_file() else 0,
    }
    if not redis_ok:
        response.status_code = 503
    return payload


@app.post("/api/competitors/ingest")
def ingest_competitors(
    body: CompetitorIngestRequest,
    user_id: UUID = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Resolve competitor URLs against Supabase summaries for an owned project."""
    verify_avatar_owner(body.avatar_id, user_id)

    from mcp.tools.scrape_competitor import scrape_competitor

    ingested: list[dict[str, Any]] = []
    errors: list[str] = []
    for item in body.competitors:
        platform = item.platform.lower().strip()
        if platform == "x":
            platform = "twitter"
        try:
            result = scrape_competitor(
                item.url.strip(),
                platform,
                avatar_id=body.avatar_id,
                user_id=str(user_id),
            )
            summary = result.get("summary") or {}
            ingested.append(
                {
                    "url": item.url.strip(),
                    "platform": platform,
                    "handle": result.get("competitor_handle")
                    or summary.get("competitor_handle"),
                    "summary": summary,
                    "scrape_status": result.get("scrape_status"),
                    "source": result.get("source"),
                }
            )
        except Exception as exc:
            errors.append(f"{item.url}: {exc}")
            logger.warning("competitor ingest failed url=%s: %s", item.url, exc)

    if not ingested:
        raise HTTPException(
            status_code=404,
            detail={
                "message": (
                    "No content summaries found for the given competitor URLs "
                    "in this project. Run research first."
                ),
                "errors": errors,
            },
        )

    handles = [i.get("handle") or i["url"] for i in ingested]
    message = (
        "Your knowledge base has been updated with competitor intelligence for: "
        + ", ".join(str(h) for h in handles)
        + ". You can ask about their tactics, hooks, content themes, or how to differentiate."
    )
    return {
        "status": "updated",
        "count": len(ingested),
        "competitors": ingested,
        "errors": errors,
        "message": message,
    }


@app.post("/api/profiling/summarize", status_code=202)
def summarize_profiling(
    body: ProfileSummarizeRequest,
    user_id: UUID = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Enqueue website crawl + profile summary on the Celery website queue."""
    verify_avatar_owner(body.avatar_id, user_id)

    from services.enqueue_profiling import EnqueueProfilingError, enqueue_profiling_summarize

    try:
        enqueue_profiling_summarize(
            avatar_id=body.avatar_id,
            user_id=str(user_id),
            force=body.force,
        )
    except EnqueueProfilingError as exc:
        raise HTTPException(
            status_code=500,
            detail=str(exc),
        ) from exc

    return {
        "status": "queued",
        "avatar_id": body.avatar_id,
        "message": (
            f"Website crawl and profile summarization queued for avatar {body.avatar_id}."
        ),
    }


@app.post("/api/translate")
def translate_texts(
    body: TranslateRequest,
    user_id: UUID = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Translate texts on-demand (cache-first OpenRouter). Authenticated users only."""
    from services.translate import TranslationError, translate_batch

    try:
        translations = translate_batch(
            body.texts,
            target_lang=body.target_lang,
            source_lang=body.source_lang,
        )
    except TranslationError as exc:
        message = str(exc)
        status = 400 if "Unsupported" in message or "Too many" in message or "chars" in message else 502
        logger.warning(
            "translate request failed: %s",
            message,
            extra={
                "user_id": str(user_id),
                "target_lang": body.target_lang,
                "source_lang": body.source_lang,
                "count": len(body.texts),
                "error": message,
            },
        )
        raise HTTPException(status_code=status, detail=message) from exc

    logger.info(
        "translate request ok",
        extra={
            "user_id": str(user_id),
            "target_lang": body.target_lang,
            "source_lang": body.source_lang,
            "count": len(body.texts),
        },
    )
    return {
        "translations": translations,
        "target_lang": body.target_lang,
        "source_lang": body.source_lang,
    }


@app.post("/api/agents/invoke")
def invoke_agent(
    body: InvokeRequest,
    user_id: UUID = Depends(get_current_user_id),
) -> StreamingResponse:
    """Invoke an agent and stream SSE events (status, token, complete, error)."""
    load_agents_env()
    verify_avatar_owner(body.avatar_id, user_id)

    # Validate tagged avatars early (ownership) before streaming
    from context.avatar_resolve import AvatarResolutionError, resolve_avatar_ids

    try:
        resolve_avatar_ids(
            user_id=str(user_id),
            avatar_id=body.avatar_id,
            tagged_avatar_ids=body.tagged_avatar_ids,
        )
    except AvatarResolutionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    try:
        agent = get_agent(body.agent_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    from constants import normalize_response_language

    try:
        response_language = normalize_response_language(body.response_language)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        normalized_history = normalize_chat_history(body.chat_history)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    from rate_limit import (
        DEFAULT_SCOPE,
        INFLIGHT_REFRESH_INTERVAL_SECS,
        admit_chat_request,
        clear_inflight,
        rate_limit_http_exception,
        refresh_inflight_ttl,
        release_inflight,
    )

    auth_user_id = str(user_id)
    auth_avatar_id = body.avatar_id
    # scope is server-controlled only — never from the client
    rate_scope = DEFAULT_SCOPE

    admit_result, inflight_token = admit_chat_request(
        auth_user_id,
        scope=rate_scope,
    )
    # Zombie streams (client gone, server still generating) hold the slot.
    # Preempt once so a new user message is never stuck behind a dead tab.
    if (
        not admit_result.allowed
        and admit_result.limit_type == "concurrent"
    ):
        logger.info(
            "agents_inflight_preempted",
            extra={
                "user_id": auth_user_id,
                "scope": rate_scope,
            },
        )
        clear_inflight(auth_user_id, scope=rate_scope)
        admit_result, inflight_token = admit_chat_request(
            auth_user_id,
            scope=rate_scope,
        )
    if not admit_result.allowed or not inflight_token:
        raise rate_limit_http_exception(admit_result)

    run_id = secrets.token_urlsafe(16)

    def event_stream():
        """Stream SSE while generation runs in a producer thread.

        Browser tab backgrounding often stalls or drops the client connection.
        Closing the agent generator on disconnect was aborting the LLM mid-reply.
        The producer finishes regardless; results are stored under run_id for
        catch-up when the tab becomes visible again.
        """
        from services.agent_run_store import AgentRunStoreError, store_run_result

        event_q: queue.Queue[dict[str, Any] | None] = queue.Queue()
        final_payload: dict[str, Any] = {
            "run_id": run_id,
            "user_id": auth_user_id,
            "avatar_id": auth_avatar_id,
            "agent": body.agent_type,
            "status": "running",
            "output": None,
            "error": None,
        }
        stop_producer = threading.Event()

        def producer() -> None:
            last_refresh = time.monotonic()
            try:
                for evt in agent.run(
                    user_id=auth_user_id,
                    avatar_id=auth_avatar_id,
                    agent_type=body.agent_type,
                    user_input=body.user_input,
                    live_mode=body.live_mode,
                    chatbot_context_on=body.chatbot_context_on,
                    competitor_url=body.competitor_url,
                    competitor_summaries=body.competitor_summaries,
                    tagged_avatar_ids=body.tagged_avatar_ids,
                    chat_history=normalized_history,
                    response_language=response_language,
                    stream=True,
                ):
                    if stop_producer.is_set():
                        break
                    now_mono = time.monotonic()
                    if now_mono - last_refresh >= INFLIGHT_REFRESH_INTERVAL_SECS:
                        still_owner = refresh_inflight_ttl(
                            auth_user_id,
                            inflight_token,
                            scope=rate_scope,
                        )
                        last_refresh = now_mono
                        if not still_owner:
                            logger.info(
                                "sse inflight preempted or expired; stopping producer",
                                extra={
                                    "user_id": auth_user_id,
                                    "agent": body.agent_type,
                                    "run_id": run_id,
                                },
                            )
                            final_payload["status"] = "preempted"
                            final_payload["error"] = (
                                "Run was superseded by a newer request."
                            )
                            break

                    event_name = evt.get("event")
                    data = evt.get("data") if isinstance(evt.get("data"), dict) else {}
                    if event_name == "complete":
                        final_payload["status"] = str(data.get("status") or "success")
                        final_payload["output"] = data.get("output")
                        final_payload["error"] = None
                    elif event_name == "error":
                        final_payload["status"] = "error"
                        final_payload["error"] = (
                            str(data.get("error"))
                            if data.get("error") is not None
                            else "Agent stream failed"
                        )
                        final_payload["output"] = data.get("output")

                    event_q.put(evt)
            except Exception as exc:
                logger.exception(
                    "agent producer failed",
                    extra={"run_id": run_id, "agent": body.agent_type},
                )
                final_payload["status"] = "error"
                final_payload["error"] = str(exc)
                event_q.put(
                    {
                        "event": "error",
                        "data": {"error": str(exc), "agent": body.agent_type},
                    }
                )
            finally:
                if final_payload.get("status") == "running":
                    final_payload["status"] = "error"
                    final_payload["error"] = "Run ended without a complete event"
                event_q.put(None)
                try:
                    store_run_result(run_id, final_payload)
                except AgentRunStoreError as store_error:
                    logger.warning(
                        "agent run result store failed",
                        extra={"run_id": run_id, "error": str(store_error)},
                    )
                release_inflight(
                    auth_user_id,
                    inflight_token,
                    scope=rate_scope,
                )

        worker = threading.Thread(
            target=producer,
            name=f"agent-run-{run_id[:8]}",
            daemon=True,
        )
        try:
            store_run_result(run_id, final_payload)
        except AgentRunStoreError as store_error:
            logger.warning(
                "agent run placeholder store failed",
                extra={"run_id": run_id, "error": str(store_error)},
            )
        worker.start()

        try:
            yield _sse(
                "status",
                {
                    "stage": "accepted",
                    "agent": body.agent_type,
                    "run_id": run_id,
                },
            )
            while True:
                try:
                    evt = event_q.get(timeout=15.0)
                except queue.Empty:
                    # Keepalive comment — helps proxies; generation continues in producer.
                    yield ": keepalive\n\n"
                    if not worker.is_alive() and event_q.empty():
                        break
                    continue
                if evt is None:
                    break
                event_name = str(evt.get("event") or "message")
                data = evt.get("data") if isinstance(evt.get("data"), dict) else {}
                if event_name == "status" and isinstance(data, dict):
                    data = {**data, "run_id": run_id}
                yield _sse(event_name, data if isinstance(data, dict) else {"raw": data})
        except GeneratorExit:
            # Client went away (tab backgrounded / navigated). Let producer finish.
            logger.info(
                "sse client gone; producer continues",
                extra={
                    "user_id": auth_user_id,
                    "agent": body.agent_type,
                    "run_id": run_id,
                },
            )
            raise
        except Exception as exc:
            logger.exception("SSE consumer failed")
            stop_producer.set()
            yield _sse("error", {"error": str(exc), "agent": body.agent_type, "run_id": run_id})
        finally:
            # Do not join forever on the request thread if the client is gone —
            # producer is daemon and releases inflight itself when done.
            if not worker.is_alive():
                pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/agents/runs/{run_id}")
def get_agent_run(
    run_id: str,
    user_id: UUID = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Fetch a finished agent run (tab-return catch-up). Owner-only."""
    from services.agent_run_store import AgentRunStoreError, get_run_result

    try:
        payload = get_run_result(run_id)
    except AgentRunStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    if payload is None:
        raise HTTPException(status_code=404, detail=f"Agent run not found: {run_id}")
    owner = payload.get("user_id")
    if owner != str(user_id):
        raise HTTPException(status_code=404, detail=f"Agent run not found: {run_id}")
    return {
        "run_id": run_id,
        "status": payload.get("status"),
        "agent": payload.get("agent"),
        "output": payload.get("output"),
        "error": payload.get("error"),
    }


@app.post("/api/embeddings/store-playbooks")
def store_playbooks(
    user_id: UUID = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Embed seed playbooks JSON and store them in Supabase playbooks table."""
    require_admin_user(user_id)

    mock_path = BACKEND_ROOT / "mock" / "mock_playbooks.json"
    if not mock_path.exists():
        raise HTTPException(status_code=404, detail=f"Missing seed file: {mock_path}")

    with open(mock_path, encoding="utf-8") as f:
        playbooks = json.load(f)

    try:
        result = store_playbooks_from_mock(playbooks)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to store playbook embeddings: {exc}",
        ) from exc

    return result


@app.post("/api/embeddings/backfill-summaries")
def backfill_summaries(
    only_missing: bool = True,
    limit: int = 200,
    user_id: UUID = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Embed instagram_content_summaries.summary JSON into the row embedding column."""
    require_admin_user(user_id)
    try:
        return backfill_content_summary_embeddings(
            only_missing=only_missing, limit=limit
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to backfill instagram_content_summaries embeddings: {exc}",
        ) from exc


@app.post("/api/embeddings/backfill-linkedin-summaries")
def backfill_linkedin_summaries(
    only_missing: bool = True,
    limit: int = 200,
    user_id: UUID = Depends(get_current_user_id),
) -> dict[str, Any]:
    """Embed linkedin_content_summaries.summary into embedding for agentic RAG."""
    require_admin_user(user_id)
    try:
        return backfill_linkedin_summary_embeddings(
            only_missing=only_missing, limit=limit
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to backfill linkedin_content_summaries embeddings: {exc}",
        ) from exc


@app.get("/api/mcp/tools")
def list_mcp_tools(
    user_id: UUID = Depends(get_current_user_id),
) -> dict[str, Any]:
    del user_id  # auth gate only
    from mcp.server import mcp_server

    return {"tools": mcp_server.list_tools()}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
