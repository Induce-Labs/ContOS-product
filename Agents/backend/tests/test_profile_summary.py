"""Unit tests for profile summary generation (no live LLM / Supabase)."""

from __future__ import annotations

import sys
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

AVATAR_ID = "00000000-0000-4000-8000-000000000001"


@pytest.fixture(autouse=True)
def _no_ambient_supermemory(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep profile tests from calling a configured Supermemory service."""
    monkeypatch.delenv("SUPERMEMORY_BASE_URL", raising=False)
    monkeypatch.delenv("SUPERMEMORY_API_KEY", raising=False)


@pytest.fixture(autouse=True)
def _profile_sync_lock_acquired():
    """Unit tests do not need a running Redis. Concurrency tests replace this."""

    @contextmanager
    def _acquired(*_args: object, **_kwargs: object):
        yield True

    with patch("services.job_lock.acquire_job_lock", _acquired):
        yield

from context.profiling_data import format_profiling_qa_for_prompt, profile_from_avatar_row
from services.profile_summary import (
    ProfileSummaryError,
    build_profile_summary_prompt,
    generate_and_store_profile_summary,
)
from services.supermemory import PROFILE_DOCUMENT_ID, SupermemoryResponse


def test_format_profiling_qa_for_prompt_supports_object_and_string_answers():
    profiling = {
        "content_goal": {
            "question_key": "content_goal",
            "question": "What is the primary goal of your content?",
            "answer": "Thought Leadership",
        },
        "website_url": "https://example.com",
    }
    pairs = format_profiling_qa_for_prompt(profiling)
    assert len(pairs) == 2
    assert pairs[0]["key"] == "content_goal"
    assert pairs[0]["answer"] == "Thought Leadership"


def test_build_profile_summary_prompt_includes_avatar_metadata():
    avatar = {
        "id": "a1",
        "name": "Acme",
        "type": "business_1",
        "profiling_data": {
            "biz_01": {
                "question": "Buying trigger?",
                "answer": "Failed vendor",
            }
        },
    }
    prompt = build_profile_summary_prompt(avatar)
    assert "Acme" in prompt
    assert "business_1" in prompt
    assert "Buying trigger?" in prompt
    assert "Failed vendor" in prompt
    assert "LLM profile-summary generation is disabled" in prompt


def test_build_profile_summary_prompt_requires_answers():
    with pytest.raises(ProfileSummaryError):
        build_profile_summary_prompt({"id": "a1", "profiling_data": {}})


def test_profile_from_avatar_row_includes_summary_fields():
    row = {
        "id": "p1",
        "user_id": "u1",
        "name": "Brand",
        "type": "personal_branding",
        "profiling_data": {"content_goal": "Leads"},
        "profile_summary": "## Goals\nLeads",
        "profile_summary_status": "completed",
        "profile_summary_generated_at": "2026-01-01T00:00:00Z",
        "profile_summary_error": None,
        "website_summary": None,
        "website_summary_status": "skipped",
    }
    profile = profile_from_avatar_row(row, "u1")
    assert profile["profile_summary"] == "## Goals\nLeads"
    assert profile["profile_summary_status"] == "completed"
    assert profile["website_summary_status"] == "skipped"


def test_generate_and_store_profile_summary_returns_cached_when_hash_matches():
    avatar = {
        "id": "a1",
        "user_id": "u1",
        "name": "Brand",
        "type": "business",
        "profiling_data": {"content_goal": "Leads"},
        "profile_summary": "Cached summary",
        "profile_summary_status": "completed",
        "profile_summary_source_hash": "abc123",
        "profile_summary_generated_at": "2026-01-01T00:00:00Z",
    }

    with patch("db.supabase_client.assert_avatar_owned", return_value=avatar):
        with patch(
            "services.profile_summary.profiling_data_hash",
            return_value="abc123",
        ):
            with patch(
                "services.profile_summary.generate_and_store_website_summary",
                return_value={
                    "avatar_id": "a1",
                    "website_summary": None,
                    "status": "skipped",
                    "cached": False,
                },
            ):
                result = generate_and_store_profile_summary(
                    avatar_id="a1",
                    user_id="u1",
                    force=False,
                )

    assert result["cached"] is True
    assert result["profile_summary"] == "Cached summary"


def test_generate_and_store_profile_summary_persists_without_llm():
    avatar = {
        "id": "a1",
        "user_id": "u1",
        "name": "Brand",
        "type": "business",
        "profiling_data": {
            "content_goal": {
                "question": "Goal?",
                "answer": "Leads",
            }
        },
        "profile_summary_status": "pending",
        "profile_summary": None,
    }

    mock_update = MagicMock()
    with patch("db.supabase_client.assert_avatar_owned", return_value=avatar):
        with patch("db.supabase_client.update_avatar_profile_summary", mock_update):
            with patch(
                "services.profile_summary.generate_and_store_website_summary",
                return_value={
                    "avatar_id": "a1",
                    "website_summary": None,
                    "status": "skipped",
                    "cached": False,
                },
            ):
                with patch(
                    "services.enqueue_profile_sync.schedule_profile_sync",
                    return_value=True,
                ):
                    result = generate_and_store_profile_summary(
                        avatar_id="a1",
                        user_id="u1",
                        force=True,
                    )

    assert result["status"] == "completed"
    assert result["cached"] is False
    assert mock_update.call_count >= 2
    completed = [
        call
        for call in mock_update.call_args_list
        if call.kwargs.get("status") == "completed"
    ]
    assert completed
    assert "summary" not in completed[-1].kwargs


def _pending_avatar() -> dict[str, object]:
    return {
        "id": AVATAR_ID,
        "user_id": "user-1",
        "name": "Brand",
        "type": "business",
        "profiling_data": {"content_goal": "MEMORY_GOAL"},
        "profile_summary_status": "pending",
    }


def _stored_avatar() -> dict[str, object]:
    return {
        "id": AVATAR_ID,
        "user_id": "user-1",
        "name": "Brand",
        "type": "business",
        "profiling_data": {"content_goal": "DATABASE_GOAL"},
        "profile_summary": "FROM_DATABASE",
        "profile_summary_status": "completed",
        "profile_summary_source_hash": "abc123",
        "profile_summary_generated_at": "2026-01-01T00:00:00Z",
        "website_summary": "FROM_DATABASE_SITE",
    }


def _queued(operation: str) -> SupermemoryResponse:
    return SupermemoryResponse(
        ok=True,
        operation=operation,
        status_code=200,
        data={"id": PROFILE_DOCUMENT_ID, "status": "queued"},
    )


def _not_found() -> SupermemoryResponse:
    return SupermemoryResponse(
        ok=False,
        operation="get_document",
        status_code=404,
        error="http_error",
    )


@contextmanager
def _generate_with_reload(mock_update: MagicMock):
    calls = {"count": 0}

    def _owned(*_args: object, **_kwargs: object) -> dict[str, object]:
        calls["count"] += 1
        if calls["count"] == 1:
            return _pending_avatar()
        return _stored_avatar()

    with (
        patch("db.supabase_client.assert_avatar_owned", side_effect=_owned),
        patch("db.supabase_client.update_avatar_profile_summary", mock_update),
        patch(
            "services.profile_summary.generate_and_store_website_summary",
            return_value={
                "avatar_id": AVATAR_ID,
                "website_summary": None,
                "status": "skipped",
                "cached": False,
            },
        ),
        patch(
            "services.enqueue_profile_sync.schedule_profile_sync",
            return_value=True,
        ),
    ):
        yield


def _assert_generation_stays_completed(mock_update: MagicMock) -> None:
    assert [call.kwargs["status"] for call in mock_update.call_args_list] == [
        "generating",
        "completed",
    ]
    assert "summary" not in mock_update.call_args_list[-1].kwargs


def test_generation_returns_without_waiting_for_supermemory() -> None:
    mock_update = MagicMock()

    def _waited(**_kwargs: object) -> None:
        raise AssertionError("profile generation waited for Supermemory")

    with _generate_with_reload(mock_update):
        with patch("services.supermemory.sync_profile_to_supermemory", side_effect=_waited):
            with patch("services.supermemory.httpx.Client") as client:
                result = generate_and_store_profile_summary(
                    avatar_id=AVATAR_ID,
                    user_id="user-1",
                    force=True,
                )

    assert result["status"] == "completed"
    assert result["cached"] is False
    assert result["profile_sync_enqueued"] is True
    _assert_generation_stays_completed(mock_update)
    client.assert_not_called()


def test_cached_summary_still_enqueues_sync_by_default() -> None:
    stored = _stored_avatar()

    def _waited(**_kwargs: object) -> None:
        raise AssertionError("cached profile response waited for Supermemory")

    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=stored),
        patch("db.supabase_client.update_avatar_profile_summary") as profile_update,
        patch("services.profile_summary.profiling_data_hash", return_value="abc123"),
        patch(
            "services.profile_summary.generate_and_store_website_summary",
            return_value={
                "avatar_id": AVATAR_ID,
                "website_summary": None,
                "status": "skipped",
                "cached": False,
            },
        ),
        patch(
            "services.enqueue_profile_sync.schedule_profile_sync",
            return_value=True,
        ) as schedule,
        patch("services.supermemory.sync_profile_to_supermemory", side_effect=_waited),
        patch("services.supermemory.httpx.Client") as client,
    ):
        result = generate_and_store_profile_summary(
            avatar_id=AVATAR_ID,
            user_id="user-1",
            force=False,
        )

    assert result["cached"] is True
    assert result["profile_summary"] == "FROM_DATABASE"
    assert result["profile_sync_enqueued"] is True
    schedule.assert_called_once_with(avatar_id=AVATAR_ID, user_id="user-1")
    profile_update.assert_not_called()
    client.assert_not_called()


def test_changed_profiling_enqueues_sync_without_llm_summary() -> None:
    stored = _stored_avatar()
    stored["profiling_data"] = {"content_goal": "NEW_GOAL"}

    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=stored),
        patch("db.supabase_client.update_avatar_profile_summary") as profile_update,
        patch("services.profile_summary.profiling_data_hash", return_value="new-hash"),
        patch(
            "services.profile_summary.generate_and_store_website_summary",
            return_value={
                "avatar_id": AVATAR_ID,
                "website_summary": None,
                "status": "skipped",
                "cached": False,
            },
        ),
        patch(
            "services.enqueue_profile_sync.schedule_profile_sync",
            return_value=True,
        ) as schedule,
    ):
        result = generate_and_store_profile_summary(
            avatar_id=AVATAR_ID,
            user_id="user-1",
            force=False,
        )

    assert result["cached"] is False
    assert result["profile_sync_enqueued"] is True
    schedule.assert_called_once_with(avatar_id=AVATAR_ID, user_id="user-1")
    assert [call.kwargs["status"] for call in profile_update.call_args_list] == [
        "generating",
        "completed",
    ]
    assert "summary" not in profile_update.call_args_list[-1].kwargs


def test_agent_context_does_not_refresh_or_wait_for_sync() -> None:
    from context.avatar_context import build_avatar_context

    row = _pending_avatar()

    def _waited(**_kwargs: object) -> None:
        raise AssertionError("agent context waited for Supermemory")

    with (
        patch("context.avatar_resolve.load_avatar_rows", return_value=[row]),
        patch(
            "context.avatar_context._competitor_context_for_avatar",
            return_value=([], []),
        ),
        patch("services.supermemory.sync_profile_to_supermemory", side_effect=_waited),
        patch("services.supermemory.httpx.Client") as client,
        patch("services.enqueue_profile_sync.schedule_profile_sync") as schedule,
        patch(
            "services.profile_summary.generate_and_store_profile_summary"
        ) as generate,
    ):
        result = build_avatar_context(
            user_id="user-1",
            avatar_ids=[AVATAR_ID],
            user_input="Write a post",
            agent_type="chatbot",
        )

    generate.assert_not_called()
    assert result["profiles"][0].get("profile_summary") is None
    client.assert_not_called()
    schedule.assert_not_called()


class _RetryCalled(Exception):
    def __init__(self, countdown: int | None, exc: BaseException | None) -> None:
        super().__init__(countdown)
        self.countdown = countdown
        self.cause = exc


def _sync_task():
    from tasks.profiling import run_profile_sync_task

    task = run_profile_sync_task
    current = getattr(task, "_get_current_object", None)
    if current is not None:
        task = current()
    return task


def _run_sync_task(retries: int = 0) -> None:
    task = _sync_task()

    def _retry(exc: BaseException | None = None, countdown: int | None = None) -> None:
        raise _RetryCalled(countdown, exc)

    task.push_request(retries=retries)
    try:
        with patch.object(task, "retry", _retry):
            task.run(AVATAR_ID, "user-1")
    finally:
        task.pop_request()


def test_profile_sync_task_posts_stored_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    created: dict[str, str] = {}
    status_update = MagicMock()

    def _create(
        namespace: str,
        document_id: str,
        content: str,
        metadata: dict[str, object] | None = None,
    ) -> SupermemoryResponse:
        created["content"] = content
        created["document_id"] = document_id
        return _queued("create_document")

    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=_stored_avatar()),
        patch("db.supabase_client.update_avatar_profile_summary", status_update),
        patch("services.supermemory.get_document", return_value=_not_found()),
        patch("services.supermemory.create_document", side_effect=_create),
        patch("services.supermemory.update_document") as update,
    ):
        _run_sync_task()

    assert created["document_id"] == PROFILE_DOCUMENT_ID
    assert "FROM_DATABASE" in created["content"]
    assert "DATABASE_GOAL" in created["content"]
    assert "FROM_DATABASE_SITE" in created["content"]
    assert "MEMORY_GOAL" not in created["content"]
    update.assert_not_called()
    status_update.assert_not_called()


def test_lock_held_schedules_a_celery_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")

    @contextmanager
    def _busy(*_args: object, **_kwargs: object):
        yield False

    with (
        patch("services.job_lock.acquire_job_lock", _busy),
        patch("services.supermemory.get_document") as get_doc,
        patch("services.supermemory.create_document") as create,
        patch("db.supabase_client.update_avatar_profile_summary") as status_update,
    ):
        with pytest.raises(_RetryCalled) as raised:
            _run_sync_task()

    assert raised.value.countdown == 15
    assert str(raised.value.cause) == "lock_held"
    get_doc.assert_not_called()
    create.assert_not_called()
    status_update.assert_not_called()


def test_profile_sync_retries_transient_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    status_update = MagicMock()
    timeout = SupermemoryResponse(ok=False, operation="get_document", error="timeout")
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=_stored_avatar()),
        patch("db.supabase_client.update_avatar_profile_summary", status_update),
        patch("services.supermemory.get_document", return_value=timeout),
        patch("services.supermemory.create_document") as create,
    ):
        with pytest.raises(_RetryCalled) as raised:
            _run_sync_task()

    assert raised.value.countdown == 15
    assert str(raised.value.cause) == "timeout"
    create.assert_not_called()
    status_update.assert_not_called()


def test_profile_sync_does_not_retry_missing_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SUPERMEMORY_BASE_URL", raising=False)
    monkeypatch.delenv("SUPERMEMORY_API_KEY", raising=False)
    status_update = MagicMock()
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=_stored_avatar()),
        patch("db.supabase_client.update_avatar_profile_summary", status_update),
        patch("services.supermemory.get_document") as get_doc,
        patch("services.supermemory.httpx.Client") as client,
    ):
        _run_sync_task()

    get_doc.assert_not_called()
    client.assert_not_called()
    status_update.assert_not_called()


def test_summarize_skip_does_not_schedule_sync() -> None:
    from tasks.profiling import run_summarize_task

    events: list[str] = []

    @contextmanager
    def _acquired(*_args: object, **_kwargs: object):
        events.append("lock")
        yield True
        events.append("unlock")

    with (
        patch("tasks.profiling.acquire_job_lock", _acquired),
        patch("tasks.profiling._should_skip", return_value=True),
        patch("services.enqueue_profile_sync.schedule_profile_sync") as schedule,
        patch("services.profile_summary.generate_and_store_profile_summary") as generate,
    ):
        run_summarize_task(AVATAR_ID, "user-1", False)

    generate.assert_not_called()
    schedule.assert_not_called()
    assert events == ["lock", "unlock"]


def test_publish_failure_recovers_after_the_profiling_lock() -> None:
    from tasks.profiling import run_summarize_task

    events: list[str] = []

    @contextmanager
    def _acquired(*_args: object, **_kwargs: object):
        events.append("lock")
        yield True
        events.append("unlock")

    def _schedule(**_kwargs: object) -> bool:
        events.append("schedule")
        return False

    def _recover(**_kwargs: object) -> None:
        events.append("recover")

    def _generate(**_kwargs: object) -> dict[str, object]:
        events.append("generate")
        return {"status": "completed", "cached": False}

    with (
        patch("tasks.profiling.acquire_job_lock", _acquired),
        patch("tasks.profiling._should_skip", return_value=False),
        patch("services.enqueue_profile_sync.schedule_profile_sync", _schedule),
        patch(
            "services.enqueue_profile_sync.recover_profile_sync_after_publish_failure",
            _recover,
        ),
        patch("services.profile_summary.generate_and_store_profile_summary", _generate),
    ):
        run_summarize_task(AVATAR_ID, "user-1", False)

    assert events == ["lock", "generate", "unlock", "schedule", "recover"]


def test_publish_failure_returns_false_without_raising(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    from services.enqueue_profile_sync import schedule_profile_sync

    with (
        patch(
            "celery_app.celery_app.send_task",
            side_effect=ConnectionError("redis down"),
        ),
        patch("services.enqueue_profile_sync.time.sleep") as sleep,
    ):
        published = schedule_profile_sync(avatar_id=AVATAR_ID, user_id="user-1")

    assert published is False
    assert sleep.call_count == 2


def test_publish_recovery_retries_then_stops(monkeypatch: pytest.MonkeyPatch) -> None:
    from services.enqueue_profile_sync import recover_profile_sync_after_publish_failure
    from services.profile_summary import ProfileSyncOutcome

    outcomes = [
        ProfileSyncOutcome(ok=False, retryable=True, error="connection_failed"),
        ProfileSyncOutcome(ok=True, retryable=False),
    ]

    with (
        patch(
            "services.profile_summary.sync_stored_profile_to_supermemory",
            side_effect=outcomes,
        ) as sync,
        patch("services.enqueue_profile_sync.time.sleep") as sleep,
        patch("db.supabase_client.update_avatar_profile_summary") as status_update,
    ):
        recover_profile_sync_after_publish_failure(
            avatar_id=AVATAR_ID,
            user_id="user-1",
        )

    assert sync.call_count == 2
    sleep.assert_called_once_with(15)
    status_update.assert_not_called()


def test_summarize_task_enqueues_sync_after_releasing_the_lock() -> None:
    from tasks.profiling import run_summarize_task

    events: list[str] = []

    @contextmanager
    def _acquired(*_args: object, **_kwargs: object):
        events.append("lock")
        yield True
        events.append("unlock")

    def _generate(**kwargs: object) -> dict[str, object]:
        events.append("generate")
        assert kwargs["schedule_sync"] is False
        return {
            "status": "completed",
            "profile_summary": "FROM_MEMORY",
            "cached": False,
        }

    def _schedule(**_kwargs: object) -> bool:
        events.append("schedule")
        return True

    with (
        patch("tasks.profiling.acquire_job_lock", _acquired),
        patch("tasks.profiling._should_skip", return_value=False),
        patch("services.profile_summary.generate_and_store_profile_summary", _generate),
        patch("services.enqueue_profile_sync.schedule_profile_sync", _schedule),
        patch(
            "services.enqueue_profile_sync.recover_profile_sync_after_publish_failure"
        ) as recover,
    ):
        run_summarize_task(AVATAR_ID, "user-1", False)

    recover.assert_not_called()
    assert events == ["lock", "generate", "unlock", "schedule"]


def test_cached_generation_inside_summarize_still_schedules_sync() -> None:
    from tasks.profiling import run_summarize_task

    @contextmanager
    def _acquired(*_args: object, **_kwargs: object):
        yield True

    with (
        patch("tasks.profiling.acquire_job_lock", _acquired),
        patch("tasks.profiling._should_skip", return_value=False),
        patch(
            "services.profile_summary.generate_and_store_profile_summary",
            return_value={"status": "completed", "cached": True},
        ),
        patch(
            "services.enqueue_profile_sync.schedule_profile_sync",
            return_value=True,
        ) as schedule,
    ):
        run_summarize_task(AVATAR_ID, "user-1", False)

    schedule.assert_called_once_with(avatar_id=AVATAR_ID, user_id="user-1")


def test_failed_profile_generation_does_not_schedule_sync() -> None:
    from tasks.profiling import run_summarize_task

    @contextmanager
    def _acquired(*_args: object, **_kwargs: object):
        yield True

    with (
        patch("tasks.profiling.acquire_job_lock", _acquired),
        patch("tasks.profiling._should_skip", return_value=False),
        patch(
            "services.profile_summary.generate_and_store_profile_summary",
            side_effect=ProfileSummaryError("model refused"),
        ),
        patch("services.enqueue_profile_sync.schedule_profile_sync") as schedule,
    ):
        with pytest.raises(ProfileSummaryError, match="model refused"):
            run_summarize_task(AVATAR_ID, "user-1", False)

    schedule.assert_not_called()


def test_completed_profile_remains_when_supermemory_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    status_update = MagicMock()
    unavailable = SupermemoryResponse(
        ok=False,
        operation="get_document",
        error="connection_failed",
    )
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=_stored_avatar()),
        patch("db.supabase_client.update_avatar_profile_summary", status_update),
        patch("services.supermemory.get_document", return_value=unavailable),
    ):
        with pytest.raises(_RetryCalled):
            _run_sync_task()

    status_update.assert_not_called()
    assert _stored_avatar()["profile_summary_status"] == "completed"


def test_concurrent_sync_of_the_same_avatar_does_not_overlap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import threading
    import time

    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    from services.profile_summary import sync_stored_profile_to_supermemory

    gate = threading.Lock()
    active = {"now": 0, "max": 0}
    written: list[str] = []

    @contextmanager
    def _one_holder(key: str, *, ttl_secs: int):
        assert key == f"profile_sync:avatar:{AVATAR_ID}"
        assert ttl_secs == 90
        acquired = gate.acquire(blocking=False)
        try:
            yield acquired
        finally:
            if acquired:
                gate.release()

    def _write(
        namespace: str,
        document_id: str,
        content: str,
        metadata: dict[str, object] | None = None,
    ) -> SupermemoryResponse:
        active["now"] += 1
        active["max"] = max(active["max"], active["now"])
        time.sleep(0.05)
        written.append(content)
        active["now"] -= 1
        return _queued("update_document")

    existing = SupermemoryResponse(
        ok=True,
        operation="get_document",
        status_code=200,
        data={"metadata": {"source_hash": "stale"}, "system": {"status": "done"}},
    )
    results: list[object] = []

    def _run() -> None:
        results.append(
            sync_stored_profile_to_supermemory(avatar_id=AVATAR_ID, user_id="user-1")
        )

    with (
        patch("services.job_lock.acquire_job_lock", _one_holder),
        patch("db.supabase_client.assert_avatar_owned", return_value=_stored_avatar()),
        patch("services.supermemory.get_document", return_value=existing),
        patch("services.supermemory.update_document", side_effect=_write),
    ):
        threads = [threading.Thread(target=_run), threading.Thread(target=_run)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

    assert active["max"] == 1
    assert len(written) == 1
    assert sum(1 for result in results if getattr(result, "ok", False)) == 1
    assert sum(1 for result in results if getattr(result, "error", None) == "lock_held") == 1


def test_stale_profile_cannot_overwrite_a_newer_document(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    from services.profile_summary import sync_stored_profile_to_supermemory

    row = _stored_avatar()
    row["profiling_data"] = {"content_goal": "VERSION_ONE"}
    written: list[str] = []
    nested: list[object] = []
    held = {"value": False}

    @contextmanager
    def _one_holder(*_args: object, **_kwargs: object):
        if held["value"]:
            yield False
            return
        held["value"] = True
        try:
            yield True
        finally:
            held["value"] = False

    def _owned(*_args: object, **_kwargs: object) -> dict[str, object]:
        return dict(row)

    def _write(
        namespace: str,
        document_id: str,
        content: str,
        metadata: dict[str, object] | None = None,
    ) -> SupermemoryResponse:
        written.append(content)
        row["profiling_data"] = {"content_goal": "VERSION_TWO"}
        nested.append(
            sync_stored_profile_to_supermemory(avatar_id=AVATAR_ID, user_id="user-1")
        )
        return _queued("update_document")

    existing = SupermemoryResponse(
        ok=True,
        operation="get_document",
        status_code=200,
        data={"metadata": {"source_hash": "stale"}, "system": {"status": "done"}},
    )
    with (
        patch("services.job_lock.acquire_job_lock", _one_holder),
        patch("db.supabase_client.assert_avatar_owned", side_effect=_owned),
        patch("services.supermemory.get_document", return_value=existing),
        patch("services.supermemory.update_document", side_effect=_write),
    ):
        first = sync_stored_profile_to_supermemory(avatar_id=AVATAR_ID, user_id="user-1")
        second = sync_stored_profile_to_supermemory(avatar_id=AVATAR_ID, user_id="user-1")

    assert first.ok is True
    assert getattr(nested[0], "error", None) == "lock_held"
    assert second.ok is True
    assert "VERSION_ONE" in written[0]
    assert "VERSION_TWO" in written[1]
    assert "VERSION_TWO" not in written[0]


@pytest.mark.parametrize("status_code", [400, 401, 403, 422])
def test_permanent_http_errors_are_not_retried(
    monkeypatch: pytest.MonkeyPatch,
    status_code: int,
) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    denied = SupermemoryResponse(
        ok=False,
        operation="get_document",
        status_code=status_code,
        error="http_error",
    )
    status_update = MagicMock()
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=_stored_avatar()),
        patch("db.supabase_client.update_avatar_profile_summary", status_update),
        patch("services.supermemory.get_document", return_value=denied),
        patch("services.supermemory.create_document") as create,
    ):
        _run_sync_task()

    create.assert_not_called()
    status_update.assert_not_called()


def test_http_429_uses_retry_after_when_it_is_longer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    limited = SupermemoryResponse(
        ok=False,
        operation="get_document",
        status_code=429,
        error="http_error",
        retry_after_seconds=45,
    )
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=_stored_avatar()),
        patch("services.supermemory.get_document", return_value=limited),
        patch("services.supermemory.create_document") as create,
    ):
        with pytest.raises(_RetryCalled) as raised:
            _run_sync_task()

    assert raised.value.countdown == 45
    assert str(raised.value.cause) == "http_error"
    create.assert_not_called()


def test_http_429_retry_after_is_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    limited = SupermemoryResponse(
        ok=False,
        operation="get_document",
        status_code=429,
        error="http_error",
        retry_after_seconds=500,
    )
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=_stored_avatar()),
        patch("services.supermemory.get_document", return_value=limited),
    ):
        with pytest.raises(_RetryCalled) as raised:
            _run_sync_task()

    assert raised.value.countdown == 120


def test_http_500_is_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    failed = SupermemoryResponse(
        ok=False,
        operation="get_document",
        status_code=500,
        error="http_error",
    )
    with (
        patch("db.supabase_client.assert_avatar_owned", return_value=_stored_avatar()),
        patch("services.supermemory.get_document", return_value=failed),
        patch("services.supermemory.create_document") as create,
    ):
        with pytest.raises(_RetryCalled) as raised:
            _run_sync_task()

    assert raised.value.countdown == 15
    create.assert_not_called()


def test_retry_loads_the_latest_owned_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    rows = [
        {**_stored_avatar(), "profiling_data": {"content_goal": "OLD_SUMMARY"}},
        {**_stored_avatar(), "profiling_data": {"content_goal": "NEW_SUMMARY"}},
    ]
    created: list[str] = []
    timeout = SupermemoryResponse(ok=False, operation="get_document", error="timeout")

    def _create(
        namespace: str,
        document_id: str,
        content: str,
        metadata: dict[str, object] | None = None,
    ) -> SupermemoryResponse:
        created.append(content)
        return _queued("create_document")

    with (
        patch("db.supabase_client.assert_avatar_owned", side_effect=rows),
        patch("services.supermemory.get_document", side_effect=[timeout, _not_found()]),
        patch("services.supermemory.create_document", side_effect=_create),
    ):
        with pytest.raises(_RetryCalled) as raised:
            _run_sync_task(retries=0)
        _run_sync_task(retries=1)

    assert raised.value.countdown == 15
    assert len(created) == 1
    assert "NEW_SUMMARY" in created[0]
    assert "OLD_SUMMARY" not in created[0]


def test_retry_exhaustion_leaves_the_stored_profile_completed(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    import logging

    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    from tasks.profiling import ProfileSyncRetryable

    timeout = SupermemoryResponse(ok=False, operation="get_document", error="timeout")
    status_update = MagicMock()
    task = _sync_task()

    def _retry(exc: BaseException | None = None, countdown: int | None = None) -> None:
        raise AssertionError("retry budget is already spent")

    with (
        caplog.at_level(logging.ERROR),
        patch("db.supabase_client.assert_avatar_owned", return_value=_stored_avatar()),
        patch("db.supabase_client.update_avatar_profile_summary", status_update),
        patch("services.supermemory.get_document", return_value=timeout),
        patch.object(task, "retry", _retry),
    ):
        task.push_request(retries=task.max_retries)
        try:
            with pytest.raises(ProfileSyncRetryable, match="timeout"):
                task.run(AVATAR_ID, "user-1")
        finally:
            task.pop_request()

    status_update.assert_not_called()
    assert _stored_avatar()["profile_summary_status"] == "completed"
    assert "profile sync retries exhausted" in caplog.text


def test_profile_sync_task_is_registered_on_the_website_queue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", "test-supermemory-key-do-not-leak")
    from celery_app import celery_app
    import tasks.profiling  # noqa: F401 — register sync task on the app
    from services.enqueue_profile_sync import schedule_profile_sync
    from services.profile_sync_policy import PROFILE_SYNC_MAX_RETRIES

    task = celery_app.tasks["profiling.sync_profile"]
    assert task.name == "profiling.sync_profile"
    assert celery_app.conf.task_routes["profiling.sync_profile"]["queue"] == "website"
    assert celery_app.conf.task_serializer == "json"
    assert celery_app.conf.task_default_queue == "website"
    assert task.max_retries == PROFILE_SYNC_MAX_RETRIES
    assert task.soft_time_limit == 45
    assert task.time_limit == 60

    with patch("celery_app.celery_app.send_task") as publish:
        assert schedule_profile_sync(avatar_id=AVATAR_ID, user_id="user-1") is True

    publish.assert_called_once_with(
        "profiling.sync_profile",
        args=[AVATAR_ID, "user-1"],
        queue="website",
    )

