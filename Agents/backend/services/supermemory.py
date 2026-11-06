"""Synchronous client for the self-hosted Supermemory v5 API.

The Agents process reads ``SUPERMEMORY_BASE_URL`` and ``SUPERMEMORY_API_KEY``
when a function is called. Missing configuration returns an error result and
does not raise, so importing this module cannot crash startup.

This client does not check avatar ownership, retry, or write to Supabase.
Callers must pass a namespace they already derived from an owned avatar id,
such as ``avatar_<uuid>``. A namespace is never taken from model output
inside this module. Document deletion is explicit only via
``delete_document`` / ``delete_documents`` — never implicit on read/write.

Each call opens one ``httpx.Client`` and closes it. A process-wide client
would keep the bearer token cached across tests and configuration changes.

Profile synchronization writes one document per avatar. The document id is
always ``profile``. Questionnaire answers stay in Supabase; strategist agents
read the mirrored profile document from Supermemory at invoke time.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import quote

import httpx

from context.profiling_data import format_profiling_qa_for_prompt, profiling_answer_text

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECS = 5.0
_NAMESPACE_MAX_LEN = 100
_DOCUMENT_ID_MAX_LEN = 255
_NAMESPACE_PATTERN = re.compile(r"^[a-zA-Z0-9_:-]+$")
PROFILE_DOCUMENT_ID = "profile"
# Never mirror scrape/analytics payloads into the profile document.
_PROFILE_CONTENT_EXCLUDE_KEYS = frozenset(
    {
        "competitor_posts",
        "scraped_posts",
        "analytics",
        "embeddings",
        "content_summaries",
        "embedding",
    }
)
_ACCEPTED_PROFILE_STATUSES = frozenset(
    {"queued", "done", "extracting", "chunking", "embedding", "indexing"}
)
_PROFILE_ACCEPTED_STATUSES = frozenset({"queued"})
_PROFILE_PROCESSING_STATUSES = frozenset(
    {"extracting", "chunking", "embedding", "indexing"}
)
_PROFILE_INDEXED_STATUSES = frozenset({"done"})
_PROFILE_UNUSABLE_STATUSES = frozenset(
    {"extracting", "chunking", "embedding", "indexing", "queued", "failed", "error"}
)

SupermemoryErrorCode = Literal[
    "missing_configuration",
    "invalid_request",
    "timeout",
    "connection_failed",
    "http_error",
    "invalid_response",
]


@dataclass(frozen=True)
class SupermemoryResponse:
    """Outcome of one Supermemory call.

    ``error`` is a stable code. It is never an exception message, response
    body, or the API key. ``data`` is present only for a 2xx JSON object.
    """

    ok: bool
    operation: str
    status_code: int | None = None
    data: dict[str, Any] | None = None
    error: SupermemoryErrorCode | None = None
    elapsed_ms: float | None = None
    retry_after_seconds: int | None = None


def is_supermemory_configured() -> bool:
    """Return whether both Supermemory environment variables are non-empty."""
    base_url, api_key = _settings()
    return bool(base_url and api_key)


def memory_document_id(kind: str, content: str) -> str:
    """Return the stable 68-character id for one kind and content string.

    The digest is SHA-256 of ``kind``, a newline, and ``content.strip().lower()``.
    Avatar isolation is the namespace, so the avatar id is not part of the hash.
    """
    normalized = f"{kind}\n{content.strip().lower()}"
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"mem_{digest}"


def get_document(namespace: str, document_id: str) -> SupermemoryResponse:
    """GET ``/ns/{namespace}/document/{document_id}``."""
    path = _document_path(namespace, document_id)
    if path is None:
        return _invalid("get_document")
    return _request("GET", path, operation="get_document")


def create_document(
    namespace: str,
    document_id: str,
    content: str,
    metadata: dict[str, Any] | None = None,
) -> SupermemoryResponse:
    """POST ``/ns/{namespace}/document`` with the caller-provided document id."""
    path = _collection_path(namespace)
    if path is None or not document_id.strip() or not content.strip():
        return _invalid("create_document")
    if len(document_id) > _DOCUMENT_ID_MAX_LEN:
        return _invalid("create_document")
    if metadata is not None and not isinstance(metadata, dict):
        return _invalid("create_document")
    body: dict[str, Any] = {"content": content, "id": document_id}
    if metadata is not None:
        body["metadata"] = metadata
    return _request("POST", path, operation="create_document", json_body=body)


def update_document(
    namespace: str,
    document_id: str,
    content: str,
    metadata: dict[str, Any] | None = None,
) -> SupermemoryResponse:
    """PATCH ``/ns/{namespace}/document/{document_id}`` and replace its content."""
    path = _document_path(namespace, document_id)
    if path is None or not content.strip():
        return _invalid("update_document")
    if metadata is not None and not isinstance(metadata, dict):
        return _invalid("update_document")
    body: dict[str, Any] = {"content": content}
    if metadata is not None:
        body["metadata"] = metadata
    return _request("PATCH", path, operation="update_document", json_body=body)


def delete_documents(
    namespace: str,
    document_ids: list[str] | tuple[str, ...],
) -> SupermemoryResponse:
    """DELETE ``/ns/{namespace}/document`` with body ``{"ids": [...]}``.

    Callers must pass exact document ids they already know. This never runs
    during normal MEMORY_READ / MEMORY_WRITE. Ownership remains the caller's
    responsibility (namespace must already come from an owned avatar).
    """
    path = _collection_path(namespace)
    if path is None:
        return _invalid("delete_documents")
    if not isinstance(document_ids, (list, tuple)) or not document_ids:
        return _invalid("delete_documents")

    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in document_ids:
        doc_id = str(raw or "").strip()
        if not doc_id or len(doc_id) > _DOCUMENT_ID_MAX_LEN:
            return _invalid("delete_documents")
        if doc_id in seen:
            continue
        seen.add(doc_id)
        cleaned.append(doc_id)
    if not cleaned:
        return _invalid("delete_documents")

    return _request(
        "DELETE",
        path,
        operation="delete_documents",
        json_body={"ids": cleaned},
    )


def delete_document(namespace: str, document_id: str) -> SupermemoryResponse:
    """Delete one document by exact id via the collection DELETE API.

    A 404 (already missing) is treated as success so callers can delete
    idempotently without distinguishing "gone" from "removed".
    """
    doc_id = str(document_id or "").strip()
    if not doc_id or len(doc_id) > _DOCUMENT_ID_MAX_LEN:
        return _invalid("delete_document")

    result = delete_documents(namespace, [doc_id])
    if result.ok:
        return SupermemoryResponse(
            ok=True,
            operation="delete_document",
            status_code=result.status_code,
            data=result.data,
            elapsed_ms=result.elapsed_ms,
        )
    if result.status_code == 404:
        return SupermemoryResponse(
            ok=True,
            operation="delete_document",
            status_code=404,
            data={"count": 0, "missing": True},
            elapsed_ms=result.elapsed_ms,
        )
    return SupermemoryResponse(
        ok=False,
        operation="delete_document",
        status_code=result.status_code,
        data=result.data,
        error=result.error,
        elapsed_ms=result.elapsed_ms,
        retry_after_seconds=result.retry_after_seconds,
    )


_SEARCH_FILTER_COMPARISON_OPS = frozenset(
    {
        "eq",
        "neq",
        "gt",
        "gte",
        "lt",
        "lte",
        "contains",
        "notContains",
        "arrayContains",
        "arrayNotContains",
    }
)
_SEARCH_FILTER_LOGICAL_OPS = frozenset({"and", "or"})
_SEARCH_FILTER_MAX_DEPTH = 4


def search_memories(
    namespace: str,
    query: str,
    limit: int = 8,
    threshold: float = 0.4,
    *,
    search_mode: Literal["memories", "hybrid", "chunks"] = "memories",
    filter: dict[str, Any] | None = None,
) -> SupermemoryResponse:
    """POST ``/ns/{namespace}/search``.

    Default ``search_mode`` is ``memories`` so unrelated callers keep the
    previous contract. Strategist retrieval passes ``hybrid`` so chunk-only
    documents remain searchable.

    Optional ``filter`` is a Supermemory ``FilterExpression`` (comparison or
    ``and``/``or`` tree). When omitted, the request body is unchanged for
    existing callers.
    """
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
        return _invalid("search_memories")
    if (
        isinstance(threshold, bool)
        or not isinstance(threshold, (int, float))
        or not 0 <= float(threshold) <= 1
    ):
        return _invalid("search_memories")
    if search_mode not in {"memories", "hybrid", "chunks"}:
        return _invalid("search_memories")
    normalized_filter: dict[str, Any] | None = None
    if filter is not None:
        normalized_filter = _normalize_search_filter(filter)
        if normalized_filter is None:
            return _invalid("search_memories")
    path = _search_path(namespace)
    if path is None or not query.strip():
        return _invalid("search_memories")
    body: dict[str, Any] = {
        "query": query,
        "searchMode": search_mode,
        "limit": limit,
        "threshold": threshold,
        "rewriteQuery": False,
        "rerank": "none",
    }
    if normalized_filter is not None:
        body["filter"] = normalized_filter
    return _request("POST", path, operation="search_memories", json_body=body)


def _normalize_search_filter(
    expression: Any,
    *,
    depth: int = 0,
) -> dict[str, Any] | None:
    """Validate and copy a Supermemory search ``filter`` expression.

    Returns ``None`` when the structure is invalid. Never mutates the caller
    value. Comparison operators require ``field`` + ``value``; logical
    ``and``/``or`` require a non-empty ``operands`` list.
    """
    if depth > _SEARCH_FILTER_MAX_DEPTH or not isinstance(expression, dict):
        return None
    operator = expression.get("operator")
    if not isinstance(operator, str) or not operator.strip():
        return None
    op = operator.strip()

    if op in _SEARCH_FILTER_LOGICAL_OPS:
        operands = expression.get("operands")
        if not isinstance(operands, list) or not operands:
            return None
        if len(expression) != 2:
            return None
        normalized_operands: list[dict[str, Any]] = []
        for item in operands:
            child = _normalize_search_filter(item, depth=depth + 1)
            if child is None:
                return None
            normalized_operands.append(child)
        return {"operator": op, "operands": normalized_operands}

    if op not in _SEARCH_FILTER_COMPARISON_OPS:
        return None
    field = expression.get("field")
    if not isinstance(field, str) or not field.strip():
        return None
    if "value" not in expression:
        return None
    value = expression.get("value")
    if not _search_filter_value_allowed(op, value):
        return None
    if len(expression) != 3:
        return None
    return {"operator": op, "field": field.strip(), "value": value}


def _search_filter_value_allowed(operator: str, value: Any) -> bool:
    if operator in {"gt", "gte", "lt", "lte"}:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if operator in {"arrayContains", "arrayNotContains"}:
        if isinstance(value, str) and value.strip():
            return True
        return isinstance(value, list) and all(
            isinstance(item, str) and bool(item.strip()) for item in value
        )
    if operator in {"contains", "notContains"}:
        return isinstance(value, str)
    # eq / neq accept string, number, or bool metadata values.
    if isinstance(value, bool):
        return True
    if isinstance(value, (int, float)):
        return True
    return isinstance(value, str)


def sync_profile_to_supermemory(
    *,
    avatar_id: str,
    profiling_data: dict[str, Any] | None = None,
    website_summary: str | None = None,
    retry_attempt: int = 0,
) -> SupermemoryResponse:
    """Create or replace the avatar profile document from questionnaire answers.

    The caller must pass an avatar id that has already passed an ownership
    check. This function does not read Supabase and does not retry. GET 200
    updates the document when ``metadata.source_hash`` differs. An equal hash
    skips PATCH. GET 404 creates document id ``profile``. A 409 from that
    create sends one PATCH to the same id. Any other GET result is returned
    and does not create a document.

    Content is built from the full ``profiling_data`` questionnaire (excluding
    scrape/analytics keys) plus optional ``website_summary``. It does not
    require or write a Supabase ``profile_summary``.
    """
    if not isinstance(avatar_id, str):
        return _invalid("sync_profile")
    owned_avatar_id = avatar_id.strip()
    if not owned_avatar_id:
        return _invalid("sync_profile")

    from services.contos_flow_log import flow_log, short_id

    namespace = f"avatar_{owned_avatar_id}"
    flow_log(
        "PROFILE_SYNC",
        "Client sync started",
        destination="Supermemory",
        namespace=short_id(namespace, keep=16),
        document_id=PROFILE_DOCUMENT_ID,
        retry_attempt=retry_attempt,
    )
    if not is_supermemory_configured():
        logger.debug(
            "supermemory profile sync skipped",
            extra={
                "operation": "sync_profile",
                "avatar_id": owned_avatar_id,
                "error": "missing_configuration",
                "retry_attempt": retry_attempt,
            },
        )
        flow_log(
            "PROFILE_SYNC",
            "Skipped",
            error="missing_configuration",
            namespace=short_id(namespace, keep=16),
        )
        return SupermemoryResponse(
            ok=False,
            operation="sync_profile",
            error="missing_configuration",
        )

    content = _profile_document_content(
        profiling_data=profiling_data,
        website_summary=website_summary,
    )
    if not content.strip():
        return _invalid("sync_profile")
    metadata = {
        "kind": "profile",
        "source": "contos_profile",
        "source_hash": hashlib.sha256(content.encode("utf-8")).hexdigest(),
    }
    existing = get_document(namespace, PROFILE_DOCUMENT_ID)
    if existing.ok:
        document_status = document_processing_status(existing.data)
        flow_log(
            "PROFILE_SYNC",
            "Existing profile document found",
            document_id=PROFILE_DOCUMENT_ID,
            processing_status=document_status or "unknown",
            status_code=existing.status_code,
        )
        if _document_source_hash(existing.data) == metadata["source_hash"]:
            _log_profile_sync(
                avatar_id=owned_avatar_id,
                operation="sync_profile",
                status_code=existing.status_code,
                document_status=document_status,
                elapsed_ms=existing.elapsed_ms,
                retry_attempt=retry_attempt,
                sync_state="up_to_date",
                error=None,
            )
            flow_log(
                "PROFILE_SYNC",
                "Skipped unchanged source hash",
                operation="GET",
                processing_status=document_status or "unknown",
                status_code=existing.status_code,
            )
            return SupermemoryResponse(
                ok=True,
                operation="sync_profile",
                status_code=existing.status_code,
                data={"up_to_date": True, "status": document_status},
                elapsed_ms=existing.elapsed_ms,
            )
        flow_log(
            "PROFILE_SYNC",
            "Updating profile document",
            operation="PATCH",
            document_id=PROFILE_DOCUMENT_ID,
        )
        return _complete_profile_write(
            update_document(
                namespace,
                PROFILE_DOCUMENT_ID,
                content,
                metadata=metadata,
            ),
            avatar_id=owned_avatar_id,
            retry_attempt=retry_attempt,
        )
    if existing.status_code == 404:
        flow_log(
            "PROFILE_SYNC",
            "Profile document missing; creating",
            operation="POST",
            document_id=PROFILE_DOCUMENT_ID,
        )
        created = create_document(
            namespace,
            PROFILE_DOCUMENT_ID,
            content,
            metadata=metadata,
        )
        if created.status_code == 409:
            logger.warning(
                "supermemory profile create conflict; patching the same document",
                extra={
                    "avatar_id": owned_avatar_id,
                    "operation": "create_document",
                    "status_code": 409,
                    "document_id": PROFILE_DOCUMENT_ID,
                    "retry_attempt": retry_attempt,
                },
            )
            flow_log(
                "PROFILE_SYNC",
                "Create conflict; patching",
                operation="PATCH",
                status_code=409,
                document_id=PROFILE_DOCUMENT_ID,
            )
            return _complete_profile_write(
                update_document(
                    namespace,
                    PROFILE_DOCUMENT_ID,
                    content,
                    metadata=metadata,
                ),
                avatar_id=owned_avatar_id,
                retry_attempt=retry_attempt,
            )
        return _complete_profile_write(
            created,
            avatar_id=owned_avatar_id,
            retry_attempt=retry_attempt,
        )

    _log_profile_sync(
        avatar_id=owned_avatar_id,
        operation="sync_profile",
        status_code=existing.status_code,
        document_status=None,
        elapsed_ms=existing.elapsed_ms,
        retry_attempt=retry_attempt,
        sync_state="failed",
        error=existing.error,
    )
    flow_log(
        "PROFILE_SYNC",
        "Failed to read profile document",
        status_code=existing.status_code,
        error=existing.error,
    )
    return existing


def _profile_document_content(
    *,
    profiling_data: dict[str, Any] | None,
    website_summary: str | None,
) -> str:
    """Build canonical profile text from full questionnaire answers + website.

    Competitor posts, analytics, and embeddings keys are omitted. Empty values
    are skipped. Does not include a generated LLM profile summary.
    """
    sections: list[str] = []
    profiling = profiling_data if isinstance(profiling_data, dict) else {}
    filtered = {
        key: value
        for key, value in profiling.items()
        if str(key).strip().lower() not in _PROFILE_CONTENT_EXCLUDE_KEYS
        and not _looks_like_embedding_payload(value)
    }
    qa_pairs = format_profiling_qa_for_prompt(filtered)
    seen_keys = {pair.get("key") for pair in qa_pairs}
    for pair in qa_pairs:
        key = pair.get("key") or "field"
        question = pair.get("question") or key
        answer = pair.get("answer") or ""
        if not answer.strip():
            continue
        sections.append(f"{key}:\nQ: {question}\nA: {answer}")
    # Catch list-shaped answers that format_profiling_qa_for_prompt skips.
    for key, value in filtered.items():
        if key in seen_keys:
            continue
        text = _meaningful_profile_text(value)
        if text is None:
            continue
        sections.append(f"{key}:\n{text}")
    website_text = _meaningful_profile_text(website_summary)
    if website_text is not None:
        sections.append(f"website_summary:\n{website_text}")
    return "\n\n".join(sections)


def _looks_like_embedding_payload(value: Any) -> bool:
    if not isinstance(value, list) or not value:
        return False
    return all(isinstance(item, (int, float)) for item in value)


def _meaningful_profile_text(value: Any) -> str | None:
    if isinstance(value, list):
        if _looks_like_embedding_payload(value):
            return None
        parts: list[str] = []
        for item in value:
            if isinstance(item, str) and item.strip():
                parts.append(item.strip())
                continue
            if isinstance(item, dict):
                # Skip scraped post-shaped objects; keep Q&A-shaped dicts.
                if "text" in item and "answer" not in item and "question" not in item:
                    continue
                answer = profiling_answer_text(item)
                if isinstance(answer, str) and answer.strip():
                    parts.append(answer.strip())
        if not parts:
            return None
        return ", ".join(parts)
    text = profiling_answer_text(value)
    if isinstance(text, str) and text.strip():
        return text.strip()
    return None


def extract_document_content(data: dict[str, Any] | None) -> str | None:
    """Return non-empty document body text from a GET document response."""
    if not isinstance(data, dict):
        return None
    for key in ("content", "raw", "text"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def profile_status_blocks_read(status: str | None) -> bool:
    """True when document status means content must not be used yet."""
    return status is not None and status in _PROFILE_UNUSABLE_STATUSES


def profile_document_ready(data: dict[str, Any] | None) -> bool:
    """True when GET data has usable content and is not still processing/failed."""
    status = document_processing_status(data)
    if profile_status_blocks_read(status):
        return False
    return extract_document_content(data) is not None


def document_processing_status(data: dict[str, Any] | None) -> str | None:
    """Return the processing status from a document or write response.

    GET document reports it at ``system.status``. POST and PATCH report it
    as the top-level ``status`` field.
    """
    if not isinstance(data, dict):
        return None
    system = data.get("system")
    if isinstance(system, dict):
        system_status = system.get("status")
        if isinstance(system_status, str) and system_status.strip():
            return system_status.strip()
    status = data.get("status")
    if isinstance(status, str) and status.strip() and status != "up_to_date":
        return status.strip()
    return None


def _document_source_hash(data: dict[str, Any] | None) -> str | None:
    """Read ``metadata.source_hash`` from a GET document response."""
    if not isinstance(data, dict):
        return None
    metadata = data.get("metadata")
    if not isinstance(metadata, dict):
        return None
    source_hash = metadata.get("source_hash")
    if isinstance(source_hash, str) and source_hash.strip():
        return source_hash.strip()
    return None


def _profile_sync_state(document_status: str | None, *, ok: bool) -> str:
    if not ok:
        return "failed"
    if document_status in _PROFILE_INDEXED_STATUSES:
        return "indexed"
    if document_status in _PROFILE_PROCESSING_STATUSES:
        return "processing"
    if document_status in _PROFILE_ACCEPTED_STATUSES:
        return "accepted"
    return "failed"


def _complete_profile_write(
    response: SupermemoryResponse,
    *,
    avatar_id: str,
    retry_attempt: int,
) -> SupermemoryResponse:
    from services.contos_flow_log import flow_log

    document_status = document_processing_status(response.data)
    result = _accept_profile_write(response)
    sync_state = _profile_sync_state(document_status, ok=result.ok)
    _log_profile_sync(
        avatar_id=avatar_id,
        operation=response.operation,
        status_code=response.status_code,
        document_status=document_status,
        elapsed_ms=response.elapsed_ms,
        retry_attempt=retry_attempt,
        sync_state=sync_state,
        error=result.error,
    )
    if result.ok:
        flow_log(
            "PROFILE_SYNC",
            "Profile document write accepted",
            operation=response.operation,
            status_code=response.status_code,
            processing_status=document_status or "unknown",
            sync_state=sync_state,
            document_id=PROFILE_DOCUMENT_ID,
        )
    else:
        flow_log(
            "PROFILE_SYNC",
            "Profile document write failed",
            operation=response.operation,
            status_code=response.status_code,
            processing_status=document_status or "unknown",
            error=result.error,
            document_id=PROFILE_DOCUMENT_ID,
        )
    return result


def _log_profile_sync(
    *,
    avatar_id: str,
    operation: str,
    status_code: int | None,
    document_status: str | None,
    elapsed_ms: float | None,
    retry_attempt: int,
    sync_state: str,
    error: str | None,
) -> None:
    payload = {
        "avatar_id": avatar_id,
        "operation": operation,
        "status_code": status_code,
        "document_status": document_status,
        "elapsed_ms": elapsed_ms,
        "retry_attempt": retry_attempt,
        "sync_state": sync_state,
        "error": error,
    }
    if sync_state == "failed":
        logger.warning("supermemory profile sync failed", extra=payload)
        return
    if sync_state == "up_to_date":
        logger.info("supermemory profile sync already up to date", extra=payload)
        return
    logger.info("supermemory profile sync finished", extra=payload)


def _accept_profile_write(response: SupermemoryResponse) -> SupermemoryResponse:
    status = document_processing_status(response.data) or ""
    if response.ok and status in _ACCEPTED_PROFILE_STATUSES:
        return response
    if response.ok:
        return SupermemoryResponse(
            ok=False,
            operation=response.operation,
            status_code=response.status_code,
            error="http_error",
            elapsed_ms=response.elapsed_ms,
        )
    return response


def _settings() -> tuple[str, str]:
    base_url = (os.getenv("SUPERMEMORY_BASE_URL") or "").strip().rstrip("/")
    api_key = (os.getenv("SUPERMEMORY_API_KEY") or "").strip()
    return base_url, api_key


def _document_path(namespace: str, document_id: str) -> str | None:
    if not _valid_namespace(namespace):
        return None
    if not _valid_segment(document_id, _DOCUMENT_ID_MAX_LEN):
        return None
    return f"/ns/{quote(namespace, safe='')}/document/{quote(document_id, safe='')}"


def _collection_path(namespace: str) -> str | None:
    if not _valid_namespace(namespace):
        return None
    return f"/ns/{quote(namespace, safe='')}/document"


def _search_path(namespace: str) -> str | None:
    if not _valid_namespace(namespace):
        return None
    return f"/ns/{quote(namespace, safe='')}/search"


def _valid_namespace(value: str) -> bool:
    return len(value) <= _NAMESPACE_MAX_LEN and _NAMESPACE_PATTERN.fullmatch(value) is not None


def _valid_segment(value: str, max_len: int) -> bool:
    return bool(value.strip()) and len(value) <= max_len


_RETRY_AFTER_MAX_SECS = 120


def _retry_after_seconds(headers: Any) -> int | None:
    """Parse a Retry-After header as whole seconds, capped at 120.

    The raw header is not logged. An unparseable value is ignored so the
    caller can use its own backoff.
    """
    raw = headers.get("Retry-After") if headers is not None else None
    if not isinstance(raw, str):
        return None
    value = raw.strip()
    if not value:
        return None
    if value.isdigit():
        return min(int(value), _RETRY_AFTER_MAX_SECS)
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError, OverflowError, IndexError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    delta = int((when - datetime.now(timezone.utc)).total_seconds())
    if delta < 0:
        return 0
    return min(delta, _RETRY_AFTER_MAX_SECS)


def _invalid(operation: str) -> SupermemoryResponse:
    logger.warning(
        "supermemory request rejected before send",
        extra={"operation": operation, "error": "invalid_request"},
    )
    return SupermemoryResponse(ok=False, operation=operation, error="invalid_request")


def _request(
    method: str,
    path: str,
    *,
    operation: str,
    json_body: dict[str, Any] | None = None,
) -> SupermemoryResponse:
    base_url, api_key = _settings()
    if not base_url or not api_key:
        logger.debug(
            "supermemory is not configured",
            extra={"operation": operation, "error": "missing_configuration"},
        )
        return SupermemoryResponse(
            ok=False,
            operation=operation,
            error="missing_configuration",
        )

    started = time.perf_counter()
    try:
        with httpx.Client(
            base_url=base_url,
            timeout=DEFAULT_TIMEOUT_SECS,
            follow_redirects=False,
            headers={"Authorization": f"Bearer {api_key}"},
        ) as client:
            response = client.request(method, path, json=json_body)
    except httpx.TimeoutException:
        return _transport_failure(operation, "timeout", started)
    except httpx.ConnectError:
        return _transport_failure(operation, "connection_failed", started)
    except httpx.RequestError:
        return _transport_failure(operation, "connection_failed", started)

    elapsed_ms = _elapsed(started)
    status_code = response.status_code
    if status_code < 200 or status_code >= 300:
        logger.warning(
            "supermemory request returned non-success status",
            extra={
                "operation": operation,
                "status_code": status_code,
                "error": "http_error",
                "elapsed_ms": elapsed_ms,
            },
        )
        return SupermemoryResponse(
            ok=False,
            operation=operation,
            status_code=status_code,
            error="http_error",
            elapsed_ms=elapsed_ms,
            retry_after_seconds=_retry_after_seconds(response.headers),
        )

    try:
        payload = response.json()
    except ValueError:
        logger.warning(
            "supermemory response was not valid JSON",
            extra={
                "operation": operation,
                "status_code": status_code,
                "error": "invalid_response",
                "elapsed_ms": elapsed_ms,
            },
        )
        return SupermemoryResponse(
            ok=False,
            operation=operation,
            status_code=status_code,
            error="invalid_response",
            elapsed_ms=elapsed_ms,
        )

    if not isinstance(payload, dict):
        logger.warning(
            "supermemory response JSON was not an object",
            extra={
                "operation": operation,
                "status_code": status_code,
                "error": "invalid_response",
                "elapsed_ms": elapsed_ms,
            },
        )
        return SupermemoryResponse(
            ok=False,
            operation=operation,
            status_code=status_code,
            error="invalid_response",
            elapsed_ms=elapsed_ms,
        )

    logger.info(
        "supermemory request succeeded",
        extra={
            "operation": operation,
            "status_code": status_code,
            "elapsed_ms": elapsed_ms,
        },
    )
    return SupermemoryResponse(
        ok=True,
        operation=operation,
        status_code=status_code,
        data=payload,
        elapsed_ms=elapsed_ms,
    )


def _transport_failure(
    operation: str,
    error: SupermemoryErrorCode,
    started: float,
) -> SupermemoryResponse:
    elapsed_ms = _elapsed(started)
    logger.warning(
        "supermemory request failed",
        extra={
            "operation": operation,
            "error": error,
            "elapsed_ms": elapsed_ms,
        },
    )
    return SupermemoryResponse(
        ok=False,
        operation=operation,
        error=error,
        elapsed_ms=elapsed_ms,
    )


def _elapsed(started: float) -> float:
    return round((time.perf_counter() - started) * 1000, 1)
