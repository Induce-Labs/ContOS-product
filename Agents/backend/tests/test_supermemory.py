"""Unit tests for the Supermemory v5 client. No network calls."""

from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.supermemory import (  # noqa: E402
    PROFILE_DOCUMENT_ID,
    SupermemoryResponse,
    _profile_document_content,
    create_document,
    delete_document,
    delete_documents,
    get_document,
    is_supermemory_configured,
    memory_document_id,
    search_memories,
    sync_profile_to_supermemory,
    update_document,
)

FAKE_KEY = "test-supermemory-key-do-not-leak"
BASE = "https://memory.example"


@pytest.fixture
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", BASE + "/")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", FAKE_KEY)


def _client(response: MagicMock | None = None, error: Exception | None = None) -> MagicMock:
    client = MagicMock()
    client.__enter__.return_value = client
    client.__exit__.return_value = False
    if error is not None:
        client.request.side_effect = error
    else:
        client.request.return_value = response
    return client


def _response(status_code: int, payload: object) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    if isinstance(payload, Exception):
        response.json.side_effect = payload
    else:
        response.json.return_value = payload
    return response


def test_missing_configuration_does_not_call_http(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUPERMEMORY_BASE_URL", raising=False)
    monkeypatch.delenv("SUPERMEMORY_API_KEY", raising=False)
    assert is_supermemory_configured() is False
    with patch("services.supermemory.httpx.Client") as constructor:
        result = get_document("avatar_1", "profile")
    constructor.assert_not_called()
    assert result.ok is False
    assert result.error == "missing_configuration"
    assert result.status_code is None
    assert FAKE_KEY not in str(result)


def test_configured_when_both_values_present(configured: None) -> None:
    assert is_supermemory_configured() is True


def test_bearer_auth_and_trailing_slash(configured: None) -> None:
    client = _client(_response(200, {"id": "profile", "content": "hello"}))
    with patch("services.supermemory.httpx.Client", return_value=client) as constructor:
        result = get_document("avatar_1", "profile")

    constructor.assert_called_once_with(
        base_url=BASE,
        timeout=5.0,
        follow_redirects=False,
        headers={"Authorization": f"Bearer {FAKE_KEY}"},
    )
    method, path = client.request.call_args.args
    assert method == "GET"
    assert path == "/ns/avatar_1/document/profile"
    assert result.ok is True
    assert result.status_code == 200
    assert result.data == {"id": "profile", "content": "hello"}
    assert FAKE_KEY not in str(result)


def test_memory_document_id_is_deterministic_and_68_chars() -> None:
    first = memory_document_id("voice", "  Keep It Short  ")
    second = memory_document_id("voice", "keep it short")
    other_kind = memory_document_id("goal", "keep it short")
    other_content = memory_document_id("voice", "keep it long")

    assert first == second
    assert len(first) == 68
    assert first.startswith("mem_")
    assert other_kind != first
    assert other_content != first


def test_create_document_posts_id_content_and_optional_metadata(configured: None) -> None:
    client = _client(_response(200, {"id": "profile", "status": "queued"}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = create_document(
            "avatar_1",
            "profile",
            "summary",
            metadata={"kind": "profile"},
        )

    method, path = client.request.call_args.args
    assert method == "POST"
    assert path == "/ns/avatar_1/document"
    assert client.request.call_args.kwargs["json"] == {
        "content": "summary",
        "id": "profile",
        "metadata": {"kind": "profile"},
    }
    assert result.ok is True
    assert result.data == {"id": "profile", "status": "queued"}


def test_create_document_omits_metadata_when_absent(configured: None) -> None:
    client = _client(_response(200, {"id": "profile", "status": "done"}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        create_document("avatar_1", "profile", "summary")
    assert client.request.call_args.kwargs["json"] == {
        "content": "summary",
        "id": "profile",
    }


def test_update_document_patches_content(configured: None) -> None:
    client = _client(_response(200, {"id": "profile", "status": "queued"}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = update_document("avatar_1", "profile", "updated")

    method, path = client.request.call_args.args
    assert method == "PATCH"
    assert path == "/ns/avatar_1/document/profile"
    assert client.request.call_args.kwargs["json"] == {"content": "updated"}
    assert result.ok is True


def test_delete_documents_posts_ids_body(configured: None) -> None:
    client = _client(_response(200, {"count": 2}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = delete_documents(
            "avatar_1",
            ["mem_aaa", "mem_bbb", "mem_aaa"],
        )

    method, path = client.request.call_args.args
    assert method == "DELETE"
    assert path == "/ns/avatar_1/document"
    assert client.request.call_args.kwargs["json"] == {
        "ids": ["mem_aaa", "mem_bbb"],
    }
    assert result.ok is True
    assert result.operation == "delete_documents"
    assert result.data == {"count": 2}


def test_delete_document_single_id_success(configured: None) -> None:
    client = _client(_response(200, {"count": 1}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = delete_document("avatar_1", "mem_only")

    method, path = client.request.call_args.args
    assert method == "DELETE"
    assert path == "/ns/avatar_1/document"
    assert client.request.call_args.kwargs["json"] == {"ids": ["mem_only"]}
    assert result.ok is True
    assert result.operation == "delete_document"


def test_delete_document_missing_is_success(configured: None) -> None:
    client = _client(_response(404, {"error": "not_found"}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = delete_document("avatar_1", "mem_gone")

    assert result.ok is True
    assert result.status_code == 404
    assert result.operation == "delete_document"
    assert (result.data or {}).get("missing") is True


def test_delete_document_http_error_is_not_ok(configured: None) -> None:
    client = _client(_response(500, {"error": "boom"}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = delete_document("avatar_1", "mem_x")

    assert result.ok is False
    assert result.status_code == 500
    assert result.error == "http_error"
    assert result.operation == "delete_document"


def test_delete_documents_rejects_blank_and_invalid_namespace(
    configured: None,
) -> None:
    client = _client(_response(200, {"count": 0}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        assert delete_documents("avatar 1", ["mem_a"]).error == "invalid_request"
        assert delete_documents("avatar_1", []).error == "invalid_request"
        assert delete_documents("avatar_1", ["  "]).error == "invalid_request"
        assert delete_document("avatar_1", "").error == "invalid_request"
    client.request.assert_not_called()


def test_search_memories_payload(configured: None) -> None:
    client = _client(_response(200, {"results": [], "searchTime": 12}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = search_memories("avatar_1", "what tone should we use?")

    method, path = client.request.call_args.args
    assert method == "POST"
    assert path == "/ns/avatar_1/search"
    assert client.request.call_args.kwargs["json"] == {
        "query": "what tone should we use?",
        "searchMode": "memories",
        "limit": 8,
        "threshold": 0.4,
        "rewriteQuery": False,
        "rerank": "none",
    }
    assert result.ok is True
    assert result.data == {"results": [], "searchTime": 12}


def test_search_memories_accepts_hybrid_mode(configured: None) -> None:
    client = _client(_response(200, {"results": [], "searchTime": 3}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = search_memories(
            "avatar_1",
            "tone",
            search_mode="hybrid",
        )

    assert result.ok is True
    assert client.request.call_args.kwargs["json"]["searchMode"] == "hybrid"
    assert "filter" not in client.request.call_args.kwargs["json"]


def test_search_memories_sends_optional_filter(configured: None) -> None:
    client = _client(_response(200, {"results": [], "searchTime": 2}))
    filt = {
        "operator": "eq",
        "field": "origin",
        "value": "contos_avatar_memory",
    }
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = search_memories(
            "avatar_1",
            "tone",
            search_mode="hybrid",
            filter=filt,
        )

    assert result.ok is True
    payload = client.request.call_args.kwargs["json"]
    assert payload["filter"] == filt
    assert payload["searchMode"] == "hybrid"
    assert payload["limit"] == 8
    assert payload["threshold"] == 0.4


def test_search_memories_sends_nested_and_filter(configured: None) -> None:
    client = _client(_response(200, {"results": [], "searchTime": 2}))
    filt = {
        "operator": "and",
        "operands": [
            {"operator": "neq", "field": "kind", "value": "profile"},
            {"operator": "eq", "field": "origin", "value": "contos_avatar_memory"},
        ],
    }
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = search_memories("avatar_1", "tone", filter=filt)

    assert result.ok is True
    assert client.request.call_args.kwargs["json"]["filter"] == filt


@pytest.mark.parametrize(
    "bad_filter",
    [
        "not-a-dict",
        {"operator": "eq"},
        {"operator": "eq", "field": "origin"},
        {"operator": "eq", "field": "", "value": "x"},
        {"operator": "nope", "field": "origin", "value": "x"},
        {"operator": "and", "operands": []},
        {"operator": "and", "operands": [{"operator": "eq", "field": "kind"}]},
        {"operator": "eq", "field": "origin", "value": "x", "extra": True},
        {"operator": "gt", "field": "score", "value": "not-a-number"},
    ],
)
def test_search_memories_rejects_invalid_filter(
    configured: None,
    bad_filter: object,
) -> None:
    with patch("services.supermemory.httpx.Client") as constructor:
        result = search_memories(
            "avatar_1",
            "tone",
            filter=bad_filter,  # type: ignore[arg-type]
        )
    constructor.assert_not_called()
    assert result.error == "invalid_request"


def test_search_memories_rejects_invalid_search_mode(configured: None) -> None:
    with patch("services.supermemory.httpx.Client") as constructor:
        result = search_memories(
            "avatar_1",
            "tone",
            search_mode="documents",  # type: ignore[arg-type]
        )
    constructor.assert_not_called()
    assert result.error == "invalid_request"


def test_document_id_path_segment_is_url_encoded(configured: None) -> None:
    client = _client(_response(200, {"id": "smoke id"}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = get_document("avatar_1", "smoke id")

    _, path = client.request.call_args.args
    assert path == "/ns/avatar_1/document/smoke%20id"
    assert result.ok is True


@pytest.mark.parametrize("limit", [0, 101, True, False])
@pytest.mark.parametrize("threshold", [0.4])
def test_search_rejects_limit_without_http(configured: None, limit: object, threshold: float) -> None:
    with patch("services.supermemory.httpx.Client") as constructor:
        result = search_memories("avatar_1", "tone", limit=limit, threshold=threshold)  # type: ignore[arg-type]
    constructor.assert_not_called()
    assert result.error == "invalid_request"


@pytest.mark.parametrize("threshold", [-0.01, 1.01, True, False])
def test_search_rejects_threshold_without_http(configured: None, threshold: object) -> None:
    with patch("services.supermemory.httpx.Client") as constructor:
        result = search_memories("avatar_1", "tone", threshold=threshold)  # type: ignore[arg-type]
    constructor.assert_not_called()
    assert result.error == "invalid_request"


def test_search_accepts_limit_and_threshold_bounds(configured: None) -> None:
    client = _client(_response(200, {"results": [], "searchTime": 1}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = search_memories("avatar_1", "tone", limit=100, threshold=0)
    assert result.ok is True
    assert client.request.call_args.kwargs["json"]["limit"] == 100
    assert client.request.call_args.kwargs["json"]["threshold"] == 0


AVATAR_NAMESPACE = "avatar_00000000-0000-4000-8000-000000000001"


def test_avatar_namespace_is_accepted(configured: None) -> None:
    client = _client(_response(200, {"id": "profile"}))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = get_document(AVATAR_NAMESPACE, "profile")
    assert result.ok is True
    assert client.request.call_args.args[1] == f"/ns/{AVATAR_NAMESPACE}/document/profile"


@pytest.mark.parametrize(
    "namespace",
    ["avatar one", "avatar/one", "avatar.one", "avatar@one", "a" * 101],
)
@pytest.mark.parametrize("call", ["get", "create", "update", "search"])
def test_invalid_namespace_makes_no_http_request(
    configured: None,
    namespace: str,
    call: str,
) -> None:
    with patch("services.supermemory.httpx.Client") as constructor:
        if call == "get":
            result = get_document(namespace, "profile")
        elif call == "create":
            result = create_document(namespace, "profile", "summary")
        elif call == "update":
            result = update_document(namespace, "profile", "summary")
        else:
            result = search_memories(namespace, "tone")
    constructor.assert_not_called()
    assert result.error == "invalid_request"


def test_http_error_does_not_return_body(configured: None) -> None:
    response = _response(500, {"error": "secret internals", "key": FAKE_KEY})
    client = _client(response)
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = get_document("avatar_1", "profile")

    assert result.ok is False
    assert result.error == "http_error"
    assert result.status_code == 500
    assert result.data is None
    response.json.assert_not_called()
    assert FAKE_KEY not in str(result)
    assert result.retry_after_seconds is None


def test_retry_after_seconds_and_http_date_are_parsed(configured: None) -> None:
    from email.utils import formatdate

    seconds = _response(429, {"error": "slow down"})
    seconds.headers = {"Retry-After": "45"}
    dated = _response(503, {"error": "busy"})
    dated.headers = {"Retry-After": formatdate(time.time() + 40, usegmt=True)}
    huge = _response(429, {"error": "slow down"})
    huge.headers = {"Retry-After": "99999"}
    invalid = _response(429, {"error": "slow down"})
    invalid.headers = {"Retry-After": "later"}

    with patch("services.supermemory.httpx.Client", return_value=_client(seconds)):
        parsed = get_document("avatar_1", "profile")
    with patch("services.supermemory.httpx.Client", return_value=_client(dated)):
        parsed_date = get_document("avatar_1", "profile")
    with patch("services.supermemory.httpx.Client", return_value=_client(huge)):
        capped = get_document("avatar_1", "profile")
    with patch("services.supermemory.httpx.Client", return_value=_client(invalid)):
        ignored = get_document("avatar_1", "profile")

    assert parsed.retry_after_seconds == 45
    assert parsed.data is None
    assert parsed_date.retry_after_seconds is not None
    assert 20 <= parsed_date.retry_after_seconds <= 120
    assert capped.retry_after_seconds == 120
    assert ignored.retry_after_seconds is None
    assert FAKE_KEY not in str(parsed)


def test_timeout(configured: None) -> None:
    client = _client(error=httpx.TimeoutException("slow"))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = search_memories("avatar_1", "tone")
    assert result.ok is False
    assert result.error == "timeout"
    assert result.status_code is None
    assert "slow" not in str(result)


def test_connection_failure(configured: None) -> None:
    client = _client(error=httpx.ConnectError("refused"))
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = get_document("avatar_1", "profile")
    assert result.error == "connection_failed"
    assert "refused" not in str(result)


def test_invalid_json(configured: None) -> None:
    response = _response(200, json.JSONDecodeError("bad", "doc", 0))
    client = _client(response)
    with patch("services.supermemory.httpx.Client", return_value=client):
        result = get_document("avatar_1", "profile")
    assert result.ok is False
    assert result.error == "invalid_response"
    assert result.status_code == 200
    assert result.data is None


def test_blank_namespace_does_not_call_http(configured: None) -> None:
    with patch("services.supermemory.httpx.Client") as constructor:
        result = get_document("  ", "profile")
    constructor.assert_not_called()
    assert result.error == "invalid_request"


AVATAR_ID = "00000000-0000-4000-8000-000000000001"
_PROFILE_SUMMARY = "A founder who writes about durable software."
_PROFILE_DATA = {"content_goal": {"question": "Goal?", "answer": "Leads"}}


def _lookup(status_code: int, error: str | None = None) -> SupermemoryResponse:
    if status_code == 200:
        return SupermemoryResponse(
            ok=True,
            operation="get_document",
            status_code=200,
            data={"id": PROFILE_DOCUMENT_ID, "content": "previous"},
        )
    return SupermemoryResponse(
        ok=False,
        operation="get_document",
        status_code=status_code,
        error=error or "http_error",
    )


def _write(operation: str, status: str = "queued") -> SupermemoryResponse:
    return SupermemoryResponse(
        ok=True,
        operation=operation,
        status_code=200,
        data={"id": PROFILE_DOCUMENT_ID, "status": status},
    )


def test_new_profile_posts_after_404(configured: None) -> None:
    with (
        patch("services.supermemory.get_document", return_value=_lookup(404)) as get_doc,
        patch("services.supermemory.create_document", return_value=_write("create_document")) as create,
        patch("services.supermemory.update_document") as update,
        patch("services.supermemory.httpx.Client") as client,
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data=_PROFILE_DATA,
        )

    assert result.ok is True
    assert result.data is not None
    assert result.data["status"] == "queued"
    get_doc.assert_called_once_with(f"avatar_{AVATAR_ID}", PROFILE_DOCUMENT_ID)
    create.assert_called_once()
    assert create.call_args.args[1] == PROFILE_DOCUMENT_ID
    update.assert_not_called()
    client.assert_not_called()


def test_existing_profile_patches_after_200(configured: None) -> None:
    with (
        patch("services.supermemory.get_document", return_value=_lookup(200)),
        patch("services.supermemory.create_document") as create,
        patch(
            "services.supermemory.update_document",
            return_value=_write("update_document", "done"),
        ) as update,
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data=_PROFILE_DATA,
        )

    assert result.ok is True
    assert result.data is not None
    assert result.data["status"] == "done"
    update.assert_called_once()
    assert update.call_args.args[1] == PROFILE_DOCUMENT_ID
    create.assert_not_called()


def test_get_timeout_does_not_post(configured: None) -> None:
    lookup = SupermemoryResponse(ok=False, operation="get_document", error="timeout")
    with (
        patch("services.supermemory.get_document", return_value=lookup),
        patch("services.supermemory.create_document") as create,
        patch("services.supermemory.update_document") as update,
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data=_PROFILE_DATA,
        )

    assert result.error == "timeout"
    create.assert_not_called()
    update.assert_not_called()


def test_get_500_does_not_post(configured: None, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("WARNING")
    with (
        patch("services.supermemory.get_document", return_value=_lookup(500)),
        patch("services.supermemory.create_document") as create,
        patch("services.supermemory.update_document") as update,
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data=_PROFILE_DATA,
        )

    assert result.status_code == 500
    assert result.error == "http_error"
    create.assert_not_called()
    update.assert_not_called()
    assert _PROFILE_SUMMARY not in caplog.text
    assert FAKE_KEY not in caplog.text
    assert "Authorization" not in caplog.text


def test_post_failure_is_returned(configured: None) -> None:
    failed = SupermemoryResponse(
        ok=False,
        operation="create_document",
        status_code=500,
        error="http_error",
    )
    with (
        patch("services.supermemory.get_document", return_value=_lookup(404)),
        patch("services.supermemory.create_document", return_value=failed) as create,
        patch("services.supermemory.update_document") as update,
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data=_PROFILE_DATA,
        )

    assert result.ok is False
    assert result.error == "http_error"
    assert create.call_count == 1
    update.assert_not_called()


def test_patch_failure_is_returned(configured: None) -> None:
    failed = SupermemoryResponse(
        ok=False,
        operation="update_document",
        status_code=500,
        error="http_error",
    )
    with (
        patch("services.supermemory.get_document", return_value=_lookup(200)),
        patch("services.supermemory.create_document") as create,
        patch("services.supermemory.update_document", return_value=failed) as update,
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data=_PROFILE_DATA,
        )

    assert result.ok is False
    assert result.error == "http_error"
    assert update.call_count == 1
    create.assert_not_called()


def test_missing_profile_configuration_does_not_call_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SUPERMEMORY_BASE_URL", raising=False)
    monkeypatch.delenv("SUPERMEMORY_API_KEY", raising=False)
    with (
        patch("services.supermemory.get_document") as get_doc,
        patch("services.supermemory.httpx.Client") as client,
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data=_PROFILE_DATA,
        )

    assert result.ok is False
    assert result.error == "missing_configuration"
    get_doc.assert_not_called()
    client.assert_not_called()


def test_profile_content_includes_only_meaningful_fields(configured: None) -> None:
    created: dict[str, object] = {}

    def _create(
        namespace: str,
        document_id: str,
        content: str,
        metadata: dict[str, object] | None = None,
    ) -> SupermemoryResponse:
        created["namespace"] = namespace
        created["document_id"] = document_id
        created["content"] = content
        created["metadata"] = metadata
        return _write("create_document")

    profiling = {
        "content_goal": {"question": "Goal?", "answer": "Leads"},
        "ideal_reader": "Founders",
        "brand_voice": "   ",
        "trends_keywords": ["AI", " ", {"answer": "video"}],
        "anything_else": "",
        "top_competitors": "COMPETITOR_POST_SECRET",
        "competitor_posts": [{"text": "SCRAPED_POST_SECRET"}],
        "analytics": {"impressions": 99},
        "embeddings": [0.12, 0.34],
    }
    with (
        patch("services.supermemory.get_document", return_value=_lookup(404)),
        patch("services.supermemory.create_document", side_effect=_create),
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data=profiling,
            website_summary="  ",
        )

    content = str(created["content"])
    metadata = created["metadata"]
    assert result.ok is True
    assert created["namespace"] == f"avatar_{AVATAR_ID}"
    assert created["document_id"] == PROFILE_DOCUMENT_ID
    assert "Profile summary:" not in content
    assert "content_goal:" in content
    assert "Leads" in content
    assert "ideal_reader:" in content
    assert "Founders" in content
    assert "trends_keywords:" in content
    assert "AI" in content and "video" in content
    assert "top_competitors:" in content
    assert "COMPETITOR_POST_SECRET" in content  # questionnaire answer, not scraped posts
    assert "brand_voice:" not in content
    assert "anything_else:" not in content
    assert "website_summary:" not in content
    assert "SCRAPED_POST_SECRET" not in content
    assert "0.12" not in content
    assert "impressions" not in content
    assert isinstance(metadata, dict)
    assert set(metadata) == {"kind", "source", "source_hash"}
    assert metadata["kind"] == "profile"
    assert metadata["source"] == "contos_profile"
    assert "SCRAPED_POST_SECRET" not in json.dumps(metadata)


def test_profile_source_hash_changes_with_canonical_content(configured: None) -> None:
    hashes: list[str] = []

    def _create(
        namespace: str,
        document_id: str,
        content: str,
        metadata: dict[str, object] | None = None,
    ) -> SupermemoryResponse:
        assert metadata is not None
        digest = metadata["source_hash"]
        assert isinstance(digest, str)
        assert digest == hashlib.sha256(content.encode("utf-8")).hexdigest()
        hashes.append(digest)
        return _write("create_document", "done")

    def _sync(profiling: dict[str, object], website: str | None) -> None:
        with (
            patch("services.supermemory.get_document", return_value=_lookup(404)),
            patch("services.supermemory.create_document", side_effect=_create),
        ):
            sync_profile_to_supermemory(
                avatar_id=AVATAR_ID,
                profiling_data=profiling,
                website_summary=website,
            )

    base = {"content_goal": "Leads", "top_competitors": "one"}
    _sync(base, None)
    _sync(base, "  ")  # blank website ignored → same hash
    _sync({"content_goal": "Awareness", "top_competitors": "one"}, None)
    _sync({"content_goal": "Leads", "top_competitors": "one"}, "Widgets for founders")
    _sync({"content_goal": "Leads", "top_competitors": "changed competitor post"}, None)

    assert hashes[0] == hashes[1]
    assert hashes[2] != hashes[0]
    assert hashes[3] != hashes[0]
    assert hashes[4] != hashes[0]


def test_same_source_hash_skips_patch(configured: None, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("INFO")
    content = _profile_document_content(
        profiling_data=_PROFILE_DATA,
        website_summary=None,
    )
    digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
    existing = SupermemoryResponse(
        ok=True,
        operation="get_document",
        status_code=200,
        data={
            "id": PROFILE_DOCUMENT_ID,
            "content": content,
            "metadata": {
                "kind": "profile",
                "source": "contos_profile",
                "source_hash": digest,
            },
            "system": {
                "status": "done",
                "createdAt": "2026-01-01T00:00:00Z",
                "updatedAt": "2026-01-01T00:00:00Z",
            },
        },
    )
    with (
        patch("services.supermemory.get_document", return_value=existing),
        patch("services.supermemory.update_document") as update,
        patch("services.supermemory.create_document") as create,
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data=_PROFILE_DATA,
        )

    assert result.ok is True
    assert result.data is not None
    assert result.data["up_to_date"] is True
    update.assert_not_called()
    create.assert_not_called()
    assert _PROFILE_SUMMARY not in caplog.text
    assert any(getattr(record, "sync_state", None) == "up_to_date" for record in caplog.records)
    assert any(getattr(record, "document_status", None) == "done" for record in caplog.records)


def test_changed_source_hash_patches(configured: None, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("INFO")
    existing = SupermemoryResponse(
        ok=True,
        operation="get_document",
        status_code=200,
        data={
            "id": PROFILE_DOCUMENT_ID,
            "content": "old",
            "metadata": {"source_hash": "stale-hash"},
            "system": {
                "status": "done",
                "createdAt": "2026-01-01T00:00:00Z",
                "updatedAt": "2026-01-01T00:00:00Z",
            },
        },
    )
    with (
        patch("services.supermemory.get_document", return_value=existing),
        patch(
            "services.supermemory.update_document",
            return_value=_write("update_document", "extracting"),
        ) as update,
        patch("services.supermemory.create_document") as create,
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data=_PROFILE_DATA,
        )

    assert result.ok is True
    update.assert_called_once()
    assert update.call_args.args[1] == PROFILE_DOCUMENT_ID
    create.assert_not_called()
    assert any(getattr(record, "sync_state", None) == "processing" for record in caplog.records)
    assert _PROFILE_SUMMARY not in caplog.text
    assert FAKE_KEY not in caplog.text


def test_create_conflict_patches_same_document(configured: None) -> None:
    conflict = SupermemoryResponse(
        ok=False,
        operation="create_document",
        status_code=409,
        error="http_error",
    )
    with (
        patch("services.supermemory.get_document", return_value=_lookup(404)),
        patch("services.supermemory.create_document", return_value=conflict) as create,
        patch(
            "services.supermemory.update_document",
            return_value=_write("update_document", "queued"),
        ) as update,
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data=_PROFILE_DATA,
        )

    assert result.ok is True
    assert result.data is not None
    assert result.data["status"] == "queued"
    create.assert_called_once()
    update.assert_called_once()
    assert create.call_args.args[1] == PROFILE_DOCUMENT_ID
    assert update.call_args.args[1] == PROFILE_DOCUMENT_ID
    assert update.call_args.args[0] == f"avatar_{AVATAR_ID}"


def test_failed_write_status_is_not_a_successful_sync(configured: None) -> None:
    failed = SupermemoryResponse(
        ok=True,
        operation="create_document",
        status_code=200,
        data={"id": PROFILE_DOCUMENT_ID, "status": "failed"},
    )
    with (
        patch("services.supermemory.get_document", return_value=_lookup(404)),
        patch("services.supermemory.create_document", return_value=failed) as create,
    ):
        result = sync_profile_to_supermemory(
            avatar_id=AVATAR_ID,
            profiling_data=_PROFILE_DATA,
        )

    assert result.ok is False
    assert result.error == "http_error"
    assert result.data is None
    assert create.call_count == 1


def test_invalid_avatar_namespace_does_not_post(configured: None) -> None:
    with (
        patch("services.supermemory.create_document") as create,
        patch("services.supermemory.update_document") as update,
        patch("services.supermemory.httpx.Client") as client,
    ):
        result = sync_profile_to_supermemory(
            avatar_id="bad id",
        )

    assert result.error == "invalid_request"
    create.assert_not_called()
    update.assert_not_called()
    client.assert_not_called()
