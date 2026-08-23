"""ContOS Agents API — FastAPI entrypoint with SSE streaming."""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

# Ensure backend/ is on sys.path for absolute imports (db, mcp, agents, ...)
BACKEND_ROOT = Path(__file__).resolve().parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

load_dotenv(BACKEND_ROOT / ".env", override=True)

from agents import get_agent  # noqa: E402
from auth import (  # noqa: E402
    get_current_user_id,
    require_admin_user,
    verify_avatar_owner,
)
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
        "http://localhost:5173,http://localhost:5174,http://localhost:3000",
    ).split(",")
    if o.strip()
]
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


class CompetitorIngestItem(BaseModel):
    url: str = Field(..., min_length=1)
    platform: str = Field(..., min_length=1)


class CompetitorIngestRequest(BaseModel):
    competitors: list[CompetitorIngestItem] = Field(..., min_length=1)
    avatar_id: str = Field(..., min_length=1)


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "contos-agents",
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
    }


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


@app.post("/api/agents/invoke")
def invoke_agent(
    body: InvokeRequest,
    user_id: UUID = Depends(get_current_user_id),
) -> StreamingResponse:
    """Invoke an agent and stream SSE events (status, token, complete, error)."""
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

    auth_user_id = str(user_id)
    auth_avatar_id = body.avatar_id

    def event_stream():
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
                stream=True,
            ):
                yield _sse(evt["event"], evt["data"])
        except Exception as exc:
            logger.exception("SSE stream failed")
            yield _sse("error", {"error": str(exc), "agent": body.agent_type})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
