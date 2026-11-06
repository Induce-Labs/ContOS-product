"""Profile context for strategists and chatbot: Supermemory primary, compact fallback.

Used by LinkedIn / Instagram / X and by chatbot when brand context is on.
Does not call ``load_strategist_memory`` and does not write to Supermemory.
Historical ``avatars.profile_summary`` is never used as fallback content.

When usable ``profile_context`` is injected, raw ``profiling_data`` is omitted from
the LLM-facing brand_profile (optional ``profiling_answer_count`` retained).
Website sibling fields are dropped when the SM document already includes website text.

``[CONTOS:PROFILE_READ]`` events are emitted for Chrome DevTools via the
existing request-scoped SSE buffer (and Redis when a flow_context is bound).
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any, Literal

from context.profiling_data import format_profiling_qa_for_prompt

logger = logging.getLogger(__name__)

ProfileContextSource = Literal["supermemory", "supabase_profiling_data", "none"]

# Log-facing source labels (stable for DevTools filters).
_LOG_SOURCE = {
    "supermemory": "supermemory",
    "supabase_profiling_data": "supabase_raw_fallback",
    "none": "none",
}

_WEBSITE_FIELDS = (
    "website_summary",
    "website_summary_status",
    "website_summary_url",
    "website_summary_generated_at",
    "website_summary_error",
)

# Prefer these questionnaire keys in the compact SM-miss fallback.
_COMPACT_PRIORITY_KEYS = (
    "brand_voice",
    "voice",
    "positioning",
    "ideal_reader",
    "audience",
    "icp",
    "content_goal",
    "goals",
    "expertise",
    "product",
    "biz_11",
    "business_name",
    "offerings",
    "website_url",
)
_COMPACT_MAX_LINES = 8
_COMPACT_MAX_ANSWER_CHARS = 160


@dataclass(frozen=True)
class ProfileContextResult:
    """Outcome of one strategist profile-context load. Never raises to callers."""

    source: ProfileContextSource
    content: str | None
    error: str | None = None
    processing_status: str | None = None
    status_code: int | None = None
    elapsed_ms: float | None = None


def format_profiling_data_fallback(profiling_data: Any) -> str | None:
    """Compact deterministic profile text for SM-miss graceful degradation.

    Prefer essential voice/audience/goal fields, then fill remaining slots from
    other answers. Truncate long answers. Never emits the full 26-answer dump.
    """
    pairs = format_profiling_qa_for_prompt(profiling_data)
    if not pairs:
        return None

    by_key = {
        str(pair.get("key") or "").strip(): pair
        for pair in pairs
        if str(pair.get("key") or "").strip()
    }
    lines: list[str] = []
    used: set[str] = set()

    def _append(key: str, pair: dict[str, str]) -> None:
        answer = (pair.get("answer") or "").strip()
        if not answer or key in used:
            return
        if len(answer) > _COMPACT_MAX_ANSWER_CHARS:
            answer = answer[: _COMPACT_MAX_ANSWER_CHARS - 1] + "…"
        lines.append(f"- {key}: {answer}")
        used.add(key)

    for key in _COMPACT_PRIORITY_KEYS:
        pair = by_key.get(key)
        if pair is None:
            continue
        _append(key, pair)
        if len(lines) >= _COMPACT_MAX_LINES:
            break

    if len(lines) < _COMPACT_MAX_LINES:
        for pair in pairs:
            key = str(pair.get("key") or "").strip() or "field"
            _append(key, pair)
            if len(lines) >= _COMPACT_MAX_LINES:
                break

    if not lines:
        return None
    return "Compact profile (Supermemory unavailable):\n" + "\n".join(lines)


def profile_context_includes_website(content: str | None) -> bool:
    """True when SM/fallback text already embeds website_summary content."""
    if not isinstance(content, str) or not content.strip():
        return False
    lowered = content.lower()
    return "website_summary:" in lowered


def load_strategist_profile_context(
    *,
    user_id: str,
    avatar_id: str,
    profiling_data: Any = None,
    agent_type: str | None = None,
) -> ProfileContextResult:
    """Load profile document content for LinkedIn / Instagram / X.

    Primary: GET Supermemory ``avatar_<uuid>/document/profile``.
    Fallback: compact raw ``profiling_data`` from the already-loaded avatar.
    Never uses ``profile_summary``. Never raises.
    """
    from services.contos_flow_log import flow_log, short_id
    from services.supermemory import (
        PROFILE_DOCUMENT_ID,
        document_processing_status,
        extract_document_content,
        get_document,
        is_supermemory_configured,
        profile_document_ready,
        profile_status_blocks_read,
    )

    owned_id = str(avatar_id or "").strip()
    agent = _agent_label(agent_type)
    if not owned_id or not str(user_id or "").strip():
        flow_log(
            "PROFILE_READ",
            "Skipped",
            error="invalid_request",
            avatar=short_id(owned_id) if owned_id else None,
            agent=agent,
        )
        return ProfileContextResult(source="none", content=None, error="invalid_request")

    try:
        from db import supabase_client as db

        row = db.assert_avatar_owned(owned_id, user_id)
        owned_id = str(row.get("id") or owned_id).strip()
        if profiling_data is None:
            profiling_data = row.get("profiling_data")
    except Exception as exc:
        logger.warning(
            "profile context ownership check failed",
            extra={"avatar_id": owned_id, "error_type": type(exc).__name__},
        )
        flow_log(
            "PROFILE_READ",
            "Ownership check failed",
            error=type(exc).__name__,
            avatar=short_id(owned_id),
            agent=agent,
        )
        return _fallback_result(
            profiling_data,
            error="ownership_failed",
            avatar_id=owned_id,
            agent=agent,
        )

    namespace = f"avatar_{owned_id}"
    flow_log(
        "PROFILE_READ",
        "Retrieval started",
        avatar=short_id(owned_id),
        agent=agent,
        namespace=short_id(namespace, keep=16),
        destination="Supermemory",
    )

    if not is_supermemory_configured():
        flow_log(
            "PROFILE_READ",
            "Supermemory request skipped",
            error="missing_configuration",
            avatar=short_id(owned_id),
            agent=agent,
        )
        return _fallback_result(
            profiling_data,
            error="missing_configuration",
            avatar_id=owned_id,
            agent=agent,
        )

    flow_log(
        "PROFILE_READ",
        "Supermemory request started",
        document_id=PROFILE_DOCUMENT_ID,
        avatar=short_id(owned_id),
        agent=agent,
        namespace=short_id(namespace, keep=16),
    )
    t0 = time.perf_counter()
    try:
        result = get_document(namespace, PROFILE_DOCUMENT_ID)
    except Exception as exc:
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
        logger.warning(
            "profile context get_document failed",
            extra={"avatar_id": owned_id, "error_type": type(exc).__name__},
        )
        flow_log(
            "PROFILE_READ",
            "Supermemory request failed",
            outcome="exception",
            error=type(exc).__name__,
            elapsed_ms=elapsed_ms,
            avatar=short_id(owned_id),
            agent=agent,
        )
        return _fallback_result(
            profiling_data,
            error="unexpected",
            avatar_id=owned_id,
            agent=agent,
            elapsed_ms=elapsed_ms,
        )

    elapsed_ms = result.elapsed_ms
    if elapsed_ms is None:
        elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    flow_log(
        "PROFILE_READ",
        "Supermemory request finished",
        outcome=("ok" if result.ok else "error"),
        status_code=result.status_code,
        error=result.error,
        elapsed_ms=elapsed_ms,
        document_id=PROFILE_DOCUMENT_ID,
        avatar=short_id(owned_id),
        agent=agent,
    )

    status = document_processing_status(result.data) if result.ok else None
    content_preview = extract_document_content(result.data) if result.ok else None
    content_chars = len(content_preview) if content_preview else 0
    ready = profile_document_ready(result.data) if result.ok else False

    if not result.ok:
        found = "no"
        reason = _fallback_reason(
            error=result.error or "http_error",
            status_code=result.status_code,
            processing_status=status,
        )
        flow_log(
            "PROFILE_READ",
            "Document validation",
            document_found=found,
            processing_status=status or "n/a",
            content_present="no",
            content_chars=0,
            ready="no",
            status_code=result.status_code,
            avatar=short_id(owned_id),
            agent=agent,
        )
        return _fallback_result(
            profiling_data,
            error=result.error or "http_error",
            avatar_id=owned_id,
            agent=agent,
            status_code=result.status_code,
            processing_status=status,
            elapsed_ms=elapsed_ms,
            reason=reason,
        )

    flow_log(
        "PROFILE_READ",
        "Document validation",
        document_found="yes",
        processing_status=status or "unknown",
        content_present=("yes" if content_chars > 0 else "no"),
        content_chars=content_chars,
        ready=("yes" if ready else "no"),
        avatar=short_id(owned_id),
        agent=agent,
    )

    if not ready:
        reason = (
            "processing_incomplete"
            if profile_status_blocks_read(status)
            else "empty_content"
        )
        return _fallback_result(
            profiling_data,
            error=(
                "processing"
                if profile_status_blocks_read(status)
                else "empty_or_unusable"
            ),
            avatar_id=owned_id,
            agent=agent,
            status_code=result.status_code,
            processing_status=status,
            elapsed_ms=elapsed_ms,
            reason=reason,
        )

    content = content_preview
    assert content is not None
    flow_log(
        "PROFILE_READ",
        "Context source selected",
        source=_LOG_SOURCE["supermemory"],
        reason="document_ready",
        content_chars=len(content),
        processing_status=status or "done",
        avatar=short_id(owned_id),
        agent=agent,
    )
    return ProfileContextResult(
        source="supermemory",
        content=content,
        processing_status=status,
        status_code=result.status_code,
        elapsed_ms=elapsed_ms,
    )


def apply_strategist_profile_context(
    profile: dict[str, Any] | None,
    result: ProfileContextResult,
    *,
    agent_type: str | None = None,
) -> dict[str, Any] | None:
    """Inject SM/fallback profile text into brand_profile without touching avatar_memory.

    Clears ``profile_summary`` on the strategist path so historical LLM summaries
    are not duplicated beside ``profile_context``. When usable context is present,
    omits raw ``profiling_data`` from the LLM-facing dict. When SM context already
    includes website text, omits sibling ``website_summary*`` fields.
    """
    from services.contos_flow_log import flow_log, short_id

    if not isinstance(profile, dict):
        flow_log(
            "PROFILE_READ",
            "Context injection skipped",
            injected="no",
            reason="missing_brand_profile",
            agent=_agent_label(agent_type),
            source=_LOG_SOURCE.get(result.source, result.source),
        )
        return profile
    updated = dict(profile)
    updated["profile_context"] = result.content
    updated["profile_context_source"] = result.source
    if result.error:
        updated["profile_context_error"] = result.error
    else:
        updated.pop("profile_context_error", None)
    # Avoid dual profile blobs in the strategist CONTEXT JSON.
    updated["profile_summary"] = None

    profiling = updated.get("profiling_data")
    has_profiling = isinstance(profiling, dict) and bool(profiling)
    profiling_count = len(profiling) if has_profiling else 0
    injected = result.content is not None and bool(str(result.content).strip())

    profiling_data_omitted = "no"
    if injected and has_profiling:
        updated.pop("profiling_data", None)
        updated["profiling_answer_count"] = profiling_count
        profiling_data_omitted = "yes"
    elif injected and not has_profiling:
        updated.pop("profiling_data", None)
        updated["profiling_answer_count"] = 0
        profiling_data_omitted = "yes"

    website_omitted = "no"
    if (
        result.source == "supermemory"
        and injected
        and profile_context_includes_website(result.content)
    ):
        for key in _WEBSITE_FIELDS:
            updated.pop(key, None)
        website_omitted = "yes"

    flow_log(
        "PROFILE_READ",
        "Context injection",
        injected=("yes" if injected else "no"),
        destination="brand_profile.profile_context",
        source=_LOG_SOURCE.get(result.source, result.source),
        content_chars=(len(result.content) if result.content else 0),
        profiling_data_present=("yes" if has_profiling else "no"),
        profiling_data_omitted=profiling_data_omitted,
        website_summary_omitted=website_omitted,
        profile_summary_cleared="yes",
        agent=_agent_label(agent_type),
        avatar=short_id(updated.get("avatar_id")),
    )
    return updated


def log_strategist_profile_llm_handoff(
    *,
    agent_type: str,
    profile: dict[str, Any] | None,
    context: dict[str, Any],
) -> None:
    """Log PROFILE_READ handoff fields and token estimates for assembled CONTEXT."""
    from context.compression import estimate_tokens
    from services.contos_flow_log import flow_log, short_id

    brand = profile if isinstance(profile, dict) else {}
    if not brand and isinstance(context.get("brand_profile"), dict):
        brand = context["brand_profile"]

    profile_context = brand.get("profile_context")
    has_pc = isinstance(profile_context, str) and bool(profile_context.strip())
    source = brand.get("profile_context_source") or "none"
    profiling = brand.get("profiling_data")
    has_profiling = isinstance(profiling, dict) and bool(profiling)

    memory = context.get("avatar_memory")
    memory_count = 0
    if isinstance(memory, dict):
        for items in memory.values():
            if isinstance(items, list):
                memory_count += len(items)
    elif isinstance(memory, list):
        memory_count = len(memory)

    competitor = context.get("competitor_intelligence") or context.get(
        "competitor_context_by_avatar"
    )
    has_competitor = False
    if isinstance(competitor, list):
        has_competitor = len(competitor) > 0
    elif isinstance(competitor, dict):
        has_competitor = bool(competitor)

    brand_profile_tokens = 0
    context_tokens = 0
    try:
        if brand:
            brand_profile_tokens = estimate_tokens(json.dumps(brand, default=str))
        context_tokens = estimate_tokens(json.dumps(context, default=str))
    except Exception:
        logger.debug("profile handoff token estimate failed", exc_info=True)

    flow_log(
        "PROFILE_READ",
        "LLM handoff",
        agent=_agent_label(agent_type),
        profile_context_present=("yes" if has_pc else "no"),
        profile_context_source=_LOG_SOURCE.get(str(source), str(source)),
        profiling_data_present=("yes" if has_profiling else "no"),
        profiling_answer_count=brand.get("profiling_answer_count"),
        avatar_memory_present=("yes" if memory_count > 0 else "no"),
        avatar_memory_count=memory_count,
        competitor_present=("yes" if has_competitor else "no"),
        profile_context_chars=(len(profile_context) if has_pc else 0),
        brand_profile_tokens=brand_profile_tokens,
        context_tokens=context_tokens,
        avatar=short_id(brand.get("avatar_id")),
    )


def _fallback_result(
    profiling_data: Any,
    *,
    error: str,
    avatar_id: str,
    agent: str = "strategist",
    status_code: int | None = None,
    processing_status: str | None = None,
    elapsed_ms: float | None = None,
    reason: str | None = None,
) -> ProfileContextResult:
    from services.contos_flow_log import flow_log, short_id

    fallback_reason = reason or _fallback_reason(
        error=error,
        status_code=status_code,
        processing_status=processing_status,
    )
    content = format_profiling_data_fallback(profiling_data)
    if content:
        flow_log(
            "PROFILE_READ",
            "Context source selected",
            source=_LOG_SOURCE["supabase_profiling_data"],
            reason=fallback_reason,
            content_chars=len(content),
            avatar=short_id(avatar_id),
            agent=agent,
            status_code=status_code,
            processing_status=processing_status,
            elapsed_ms=elapsed_ms,
            fallback="compact",
        )
        return ProfileContextResult(
            source="supabase_profiling_data",
            content=content,
            error=error,
            status_code=status_code,
            processing_status=processing_status,
            elapsed_ms=elapsed_ms,
        )

    flow_log(
        "PROFILE_READ",
        "Context source selected",
        source=_LOG_SOURCE["none"],
        reason=fallback_reason,
        content_chars=0,
        avatar=short_id(avatar_id),
        agent=agent,
        status_code=status_code,
        processing_status=processing_status,
        elapsed_ms=elapsed_ms,
    )
    return ProfileContextResult(
        source="none",
        content=None,
        error=error,
        status_code=status_code,
        processing_status=processing_status,
        elapsed_ms=elapsed_ms,
    )


def _agent_label(agent_type: str | None) -> str:
    raw = str(agent_type or "").strip().lower()
    if raw == "twitter":
        return "x"
    if raw in {"linkedin", "instagram", "x", "chatbot"}:
        return raw
    return raw or "strategist"


def _fallback_reason(
    *,
    error: str | None,
    status_code: int | None,
    processing_status: str | None,
) -> str:
    err = (error or "").strip().lower()
    if err == "missing_configuration":
        return "missing_configuration"
    if err == "timeout":
        return "timeout"
    if err == "connection_failed":
        return "connection_failure"
    if err in {"processing", "processing_incomplete"}:
        return "processing_incomplete"
    if err in {"empty_or_unusable", "empty_content"}:
        return "empty_content"
    if err == "invalid_response":
        return "invalid_response"
    if err == "ownership_failed":
        return "ownership_failed"
    if err == "invalid_request":
        return "invalid_request"
    if status_code == 404:
        return "document_not_found"
    if err == "http_error":
        return "http_error"
    if processing_status and processing_status not in {"done"}:
        return "processing_incomplete"
    return err or "unknown"
