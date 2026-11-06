"""Per-avatar persistent memory shared by the LinkedIn, Instagram and X agents.

New strategist memory writes go to Supermemory. Historical ``avatar_memory``
rows in Supabase remain readable for fallback retrieval only.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from db import supabase_client as db

logger = logging.getLogger(__name__)

MEMORY_KINDS = ("positioning", "goal", "voice", "story", "thesis", "rejection", "note")
MEMORY_SOURCES = ("user", "scraped", "inferred")
MEMORY_PLATFORMS = ("instagram", "linkedin", "twitter")
MAX_ITEMS_PER_TURN = 6
MAX_LOADED_ITEMS = 40
MAX_CONTENT_CHARS = 1000
STRATEGIST_MEMORY_SEARCH_LIMIT = 8
STRATEGIST_MEMORY_SEARCH_THRESHOLD = 0.4
STRATEGIST_MEMORY_QUERY_MAX_CHARS = 500
STRATEGIST_MEMORY_ORIGIN = "contos_avatar_memory"
# Server-side metadata filter so profile chunks cannot crowd out mem_* hits.
STRATEGIST_MEMORY_SEARCH_FILTER: dict[str, str] = {
    "operator": "eq",
    "field": "origin",
    "value": STRATEGIST_MEMORY_ORIGIN,
}
_MEMORY_WRITE_MAX_ATTEMPTS = 3
_MEMORY_WRITE_TRANSIENT_ERRORS = frozenset({"timeout", "connection_failed"})
_MEMORY_WRITE_TRANSIENT_STATUS = frozenset({408, 429, 500, 502, 503, 504})


def load_avatar_memory(
    *,
    user_id: str,
    avatar_id: str,
    purpose: str = "historical",
) -> list[dict[str, Any]]:
    """Return active memory items for an owned avatar, newest first per kind."""
    from services.contos_flow_log import flow_log, short_id

    flow_log(
        "MEMORY_READ",
        "Supabase historical load started",
        avatar=short_id(avatar_id),
        purpose=purpose,
    )
    try:
        db.assert_avatar_owned(avatar_id, user_id)
        result = (
            db._require_client()
            .table("avatar_memory")
            .select("id, kind, content, source, platform, created_at")
            .eq("avatar_id", str(avatar_id))
            .eq("status", "active")
            .order("created_at", desc=True)
            .limit(MAX_LOADED_ITEMS)
            .execute()
        )
        rows = [row for row in (result.data or []) if isinstance(row, dict)]
        flow_log(
            "MEMORY_READ",
            "Supabase historical load completed",
            avatar=short_id(avatar_id),
            purpose=purpose,
            memories=len(rows),
            empty=("yes" if not rows else "no"),
        )
        return rows
    except Exception as exc:
        logger.warning("avatar memory load failed: %s", exc)
        flow_log(
            "MEMORY_READ",
            "Supabase historical load failed",
            avatar=short_id(avatar_id),
            purpose=purpose,
            error=type(exc).__name__,
        )
        return []


def load_strategist_memory(
    *,
    user_id: str,
    avatar_id: str,
    user_input: str,
) -> list[dict[str, Any]]:
    """Load strategist memory from Supermemory, with Supabase only on failure.

    A successful empty search returns ``[]`` and does not read historical
    ``avatar_memory`` rows. Ownership is checked before any namespace is built.
    """
    from services.contos_flow_log import flow_log, short_id

    owned = db.assert_avatar_owned(avatar_id, user_id)
    owned_avatar_id = str(owned.get("id") or "").strip()
    if not owned_avatar_id:
        raise ValueError("owned avatar id is required for strategist memory")

    from services.supermemory import is_supermemory_configured, search_memories

    namespace = f"avatar_{owned_avatar_id}"
    flow_log(
        "MEMORY_READ",
        "Started",
        source="Supermemory",
        mode="hybrid",
        threshold=STRATEGIST_MEMORY_SEARCH_THRESHOLD,
        namespace=short_id(namespace, keep=16),
        avatar=short_id(owned_avatar_id),
    )

    if not is_supermemory_configured():
        flow_log(
            "MEMORY_READ",
            "Supermemory unavailable",
            error="missing_configuration",
        )
        return _supabase_strategist_fallback(
            user_id=user_id,
            avatar_id=owned_avatar_id,
            error="missing_configuration",
        )

    query = str(user_input or "").strip()[:STRATEGIST_MEMORY_QUERY_MAX_CHARS]
    if not query:
        flow_log(
            "MEMORY_READ",
            "Completed",
            source="Empty result",
            memories=0,
            reason="empty_query",
        )
        logger.info(
            "strategist memory retrieval finished",
            extra={
                "avatar_id": owned_avatar_id,
                "memory_source": "empty",
                "result_count": 0,
                "elapsed_ms": 0.0,
            },
        )
        return []

    flow_log(
        "MEMORY_READ",
        "Search request",
        mode="hybrid",
        threshold=STRATEGIST_MEMORY_SEARCH_THRESHOLD,
        query_len=len(query),
        limit=STRATEGIST_MEMORY_SEARCH_LIMIT,
        filter_field=STRATEGIST_MEMORY_SEARCH_FILTER["field"],
        filter_operator=STRATEGIST_MEMORY_SEARCH_FILTER["operator"],
        filter_value=STRATEGIST_MEMORY_SEARCH_FILTER["value"],
    )
    started = time.perf_counter()
    response = search_memories(
        namespace,
        query,
        limit=STRATEGIST_MEMORY_SEARCH_LIMIT,
        threshold=STRATEGIST_MEMORY_SEARCH_THRESHOLD,
        search_mode="hybrid",
        filter=STRATEGIST_MEMORY_SEARCH_FILTER,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000, 1)

    if not response.ok:
        flow_log(
            "MEMORY_READ",
            "Supermemory unavailable",
            error=response.error or "http_error",
            status_code=response.status_code,
            elapsed_ms=elapsed_ms,
        )
        return _supabase_strategist_fallback(
            user_id=user_id,
            avatar_id=owned_avatar_id,
            error=response.error or "http_error",
            elapsed_ms=elapsed_ms,
            status_code=response.status_code,
        )

    payload = response.data
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        flow_log(
            "MEMORY_READ",
            "Supermemory unavailable",
            error="invalid_response",
            status_code=response.status_code,
            elapsed_ms=elapsed_ms,
        )
        return _supabase_strategist_fallback(
            user_id=user_id,
            avatar_id=owned_avatar_id,
            error="invalid_response",
            elapsed_ms=elapsed_ms,
            status_code=response.status_code,
        )

    mapped, map_stats = _map_supermemory_search_results_with_stats(payload["results"])
    raw_hits = len(payload["results"])
    flow_log(
        "MEMORY_READ",
        "Search completed",
        raw_hits=raw_hits,
        mapped=len(mapped),
        profile_excluded=map_stats["profile_excluded"],
        duplicates_removed=map_stats["duplicates_removed"],
        blank_skipped=map_stats["blank_skipped"],
        elapsed_ms=elapsed_ms,
    )
    if mapped:
        flow_log(
            "MEMORY_READ",
            "Completed",
            source="Supermemory",
            memories=len(mapped),
            elapsed_ms=elapsed_ms,
        )
        memory_source = "supermemory"
    else:
        flow_log(
            "MEMORY_READ",
            "Successful empty search; Supabase fallback not triggered",
            raw_hits=raw_hits,
            elapsed_ms=elapsed_ms,
        )
        flow_log(
            "MEMORY_READ",
            "Completed",
            source="Empty result",
            memories=0,
            elapsed_ms=elapsed_ms,
        )
        memory_source = "empty"
    logger.info(
        "strategist memory retrieval finished",
        extra={
            "avatar_id": owned_avatar_id,
            "memory_source": memory_source,
            "result_count": len(mapped),
            "elapsed_ms": elapsed_ms,
        },
    )
    return mapped


def _supabase_strategist_fallback(
    *,
    user_id: str,
    avatar_id: str,
    error: str,
    elapsed_ms: float | None = None,
    status_code: int | None = None,
) -> list[dict[str, Any]]:
    from services.contos_flow_log import flow_log, short_id

    logger.warning(
        "strategist memory falling back to Supabase",
        extra={
            "avatar_id": avatar_id,
            "memory_source": "supabase_fallback",
            "error": error,
            "status_code": status_code,
            "elapsed_ms": elapsed_ms,
        },
    )
    flow_log(
        "MEMORY_READ",
        "Falling back to Supabase",
        avatar=short_id(avatar_id),
        error=error,
        status_code=status_code,
    )
    rows = load_avatar_memory(
        user_id=user_id,
        avatar_id=avatar_id,
        purpose="supermemory_fallback",
    )
    flow_log(
        "MEMORY_READ",
        "Completed",
        source="Supabase fallback",
        memories=len(rows),
        elapsed_ms=elapsed_ms,
    )
    logger.info(
        "strategist memory retrieval finished",
        extra={
            "avatar_id": avatar_id,
            "memory_source": "supabase_fallback",
            "result_count": len(rows),
            "elapsed_ms": elapsed_ms,
            "error": error,
        },
    )
    return rows


def _hit_text(item: dict[str, Any]) -> str | None:
    """Return non-empty memory text, else non-empty chunk text."""
    for key in ("memory", "chunk"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _map_supermemory_search_results(results: list[Any]) -> list[dict[str, Any]]:
    """Map hybrid search hits into the flat avatar_memory shape."""
    mapped, _stats = _map_supermemory_search_results_with_stats(results)
    return mapped


def _map_supermemory_search_results_with_stats(
    results: list[Any],
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Map hybrid search hits and return exclusion/dedupe counters."""
    mapped: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    profile_excluded = 0
    duplicates_removed = 0
    blank_skipped = 0
    for item in results:
        if len(mapped) >= STRATEGIST_MEMORY_SEARCH_LIMIT:
            break
        if not isinstance(item, dict):
            blank_skipped += 1
            continue
        content = _hit_text(item)
        if content is None:
            blank_skipped += 1
            continue
        metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
        kind = str(metadata.get("kind") or "").strip().lower()
        origin = str(metadata.get("origin") or "").strip().lower()
        source = str(metadata.get("source") or "").strip().lower()
        # Profile documents are synchronized separately; they are not avatar_memory items.
        if (
            kind == "profile"
            or origin == "contos_profile"
            or source == "contos_profile"
        ):
            profile_excluded += 1
            continue
        if kind not in MEMORY_KINDS:
            kind = "note"
        normalized_content = content[:MAX_CONTENT_CHARS]
        dedupe_key = (kind, normalized_content.lower())
        if dedupe_key in seen:
            duplicates_removed += 1
            continue
        seen.add(dedupe_key)
        if source not in MEMORY_SOURCES:
            source = "inferred"
        platform_raw = metadata.get("platform")
        platform = (
            str(platform_raw).strip().lower()
            if isinstance(platform_raw, str)
            else None
        )
        if platform not in MEMORY_PLATFORMS:
            platform = None
        system = item.get("system") if isinstance(item.get("system"), dict) else {}
        created_at = system.get("updatedAt") or system.get("createdAt")
        if not isinstance(created_at, str) or not created_at.strip():
            created_at = None
        result_id = item.get("id")
        mapped.append(
            {
                "id": str(result_id) if result_id is not None else None,
                "kind": kind,
                "content": normalized_content,
                "source": source,
                "platform": platform,
                "created_at": created_at,
            }
        )
    return mapped, {
        "profile_excluded": profile_excluded,
        "duplicates_removed": duplicates_removed,
        "blank_skipped": blank_skipped,
    }


def save_memory_updates(
    *,
    user_id: str,
    avatar_id: str,
    platform: str,
    updates: Any,
) -> list[dict[str, Any]]:
    """Validate and write strategist memory items to Supermemory; never raises.

    Ownership is checked before any namespace is built. Validated items use
    deterministic document ids so repeats are idempotent. HTTP 409 is treated
    as success. Transient transport and HTTP failures retry a few times; other
    failures are logged and skipped. Nothing is inserted into Supabase.
    """
    from services.contos_flow_log import flow_log, short_id

    proposed = len(updates) if isinstance(updates, list) else 0
    agent = platform if platform in MEMORY_PLATFORMS else (platform or "unknown")
    flow_log(
        "MEMORY_WRITE",
        "Started",
        agent=agent,
        proposed=proposed,
        destination="Supermemory",
    )
    if not isinstance(updates, list) or not updates:
        flow_log(
            "MEMORY_WRITE",
            "Completed",
            successful=0,
            failed=0,
            skipped=proposed,
            reason="no_updates",
        )
        return []
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    platform_value = platform if platform in MEMORY_PLATFORMS else None
    rejected = 0
    from services.draft_grounding import is_temporary_memory_content

    for raw in updates[:MAX_ITEMS_PER_TURN]:
        if not isinstance(raw, dict):
            rejected += 1
            continue
        kind = str(raw.get("kind") or "").strip().lower()
        content = str(raw.get("content") or "").strip()[:MAX_CONTENT_CHARS]
        source = str(raw.get("source") or "inferred").strip().lower()
        if kind not in MEMORY_KINDS or not content:
            rejected += 1
            continue
        if source not in MEMORY_SOURCES:
            source = "inferred"
        # Defense in depth: inferred notes and session-meta never reach Supermemory,
        # even if a caller bypasses filter_memory_updates.
        if source == "inferred" and kind == "note":
            rejected += 1
            continue
        if is_temporary_memory_content(content):
            rejected += 1
            continue
        key = (kind, content.lower())
        if key in seen:
            rejected += 1
            continue
        seen.add(key)
        rows.append(
            {
                "kind": kind,
                "content": content,
                "source": source,
                "platform": platform_value,
            }
        )
    # Items beyond the per-turn cap count as rejected for observability.
    if len(updates) > MAX_ITEMS_PER_TURN:
        rejected += len(updates) - MAX_ITEMS_PER_TURN
    flow_log(
        "MEMORY_WRITE",
        "Validation complete",
        accepted=len(rows),
        rejected=rejected,
    )
    if not rows:
        flow_log(
            "MEMORY_WRITE",
            "Completed",
            successful=0,
            failed=0,
            skipped=rejected,
            reason="none_accepted",
        )
        return []
    try:
        owned = db.assert_avatar_owned(avatar_id, user_id)
    except Exception as exc:
        logger.warning(
            "avatar memory save rejected",
            extra={"error": type(exc).__name__},
        )
        flow_log(
            "MEMORY_WRITE",
            "Completed",
            successful=0,
            failed=0,
            skipped=len(rows),
            error="ownership_rejected",
        )
        return []
    owned_avatar_id = str(owned.get("id") or "").strip()
    if not owned_avatar_id:
        logger.warning(
            "avatar memory save rejected",
            extra={"error": "missing_owned_avatar_id"},
        )
        flow_log(
            "MEMORY_WRITE",
            "Completed",
            successful=0,
            failed=0,
            skipped=len(rows),
            error="missing_owned_avatar_id",
        )
        return []

    from services.supermemory import (
        create_document,
        is_supermemory_configured,
        memory_document_id,
    )

    if not is_supermemory_configured():
        logger.warning(
            "avatar memory write skipped",
            extra={
                "avatar_id": owned_avatar_id,
                "error": "missing_configuration",
                "result_count": 0,
            },
        )
        flow_log(
            "MEMORY_WRITE",
            "Completed",
            successful=0,
            failed=0,
            skipped=len(rows),
            error="missing_configuration",
        )
        return []

    namespace = f"avatar_{owned_avatar_id}"
    flow_log(
        "MEMORY_WRITE",
        "Writing accepted memories",
        namespace=short_id(namespace, keep=16),
        accepted=len(rows),
        destination="Supermemory",
    )
    saved: list[dict[str, Any]] = []
    failed = 0
    conflicts = 0
    for row in rows:
        document_id = memory_document_id(row["kind"], row["content"])
        metadata = {
            "kind": row["kind"],
            "source": row["source"],
            "platform": row["platform"],
            "origin": STRATEGIST_MEMORY_ORIGIN,
        }
        response = _create_memory_document(
            namespace=namespace,
            document_id=document_id,
            content=row["content"],
            metadata=metadata,
            create_document=create_document,
        )
        if response.ok or response.status_code == 409:
            saved.append(
                {
                    "id": document_id,
                    "kind": row["kind"],
                    "content": row["content"],
                    "source": row["source"],
                    "platform": row["platform"],
                    "avatar_id": owned_avatar_id,
                }
            )
            conflict = response.status_code == 409
            if conflict:
                conflicts += 1
            flow_log(
                "MEMORY_WRITE",
                "Stored" if not conflict else "Already stored",
                destination="Supermemory",
                kind=row["kind"],
                document_id=short_id(document_id, keep=12),
                status_code=response.status_code,
                conflict=("yes" if conflict else "no"),
            )
            logger.info(
                "avatar memory write finished",
                extra={
                    "avatar_id": owned_avatar_id,
                    "operation": "create_document",
                    "status_code": response.status_code,
                    "document_id": document_id,
                    "error": None if response.ok else "conflict",
                    "elapsed_ms": response.elapsed_ms,
                },
            )
            continue
        failed += 1
        flow_log(
            "MEMORY_WRITE",
            "Write failed",
            kind=row["kind"],
            document_id=short_id(document_id, keep=12),
            status_code=response.status_code,
            error=response.error,
        )
        logger.warning(
            "avatar memory write failed",
            extra={
                "avatar_id": owned_avatar_id,
                "operation": response.operation,
                "status_code": response.status_code,
                "document_id": document_id,
                "error": response.error,
                "elapsed_ms": response.elapsed_ms,
            },
        )
    flow_log(
        "MEMORY_WRITE",
        "Completed",
        successful=len(saved),
        failed=failed,
        conflicts=conflicts,
        rejected=rejected,
    )
    return saved


def _create_memory_document(
    *,
    namespace: str,
    document_id: str,
    content: str,
    metadata: dict[str, Any],
    create_document: Any,
) -> Any:
    """Create one memory document, retrying only transient failures."""
    from services.contos_flow_log import flow_log, short_id

    last: Any = None
    for attempt in range(_MEMORY_WRITE_MAX_ATTEMPTS):
        flow_log(
            "MEMORY_WRITE",
            "Write attempt",
            attempt=attempt + 1,
            document_id=short_id(document_id, keep=12),
            kind=metadata.get("kind"),
        )
        last = create_document(namespace, document_id, content, metadata=metadata)
        if last.ok or last.status_code == 409:
            return last
        transient = last.error in _MEMORY_WRITE_TRANSIENT_ERRORS or (
            last.status_code in _MEMORY_WRITE_TRANSIENT_STATUS
        )
        if not transient or attempt >= _MEMORY_WRITE_MAX_ATTEMPTS - 1:
            return last
        logger.warning(
            "avatar memory write retrying",
            extra={
                "operation": last.operation,
                "status_code": last.status_code,
                "document_id": document_id,
                "error": last.error,
                "retry_attempt": attempt + 1,
            },
        )
        flow_log(
            "MEMORY_WRITE",
            "Retrying transient failure",
            attempt=attempt + 1,
            status_code=last.status_code,
            error=last.error,
            document_id=short_id(document_id, keep=12),
        )
        delay = 0.25 * (2**attempt)
        retry_after = getattr(last, "retry_after_seconds", None)
        if isinstance(retry_after, int) and retry_after > 0:
            delay = min(float(retry_after), 2.0)
        time.sleep(delay)
    return last
