"""Tests for Agents Celery profiling enqueue and Redis health."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


class TestEnqueueProfiling:
    def test_publishes_to_website_queue(self) -> None:
        from services.enqueue_profiling import enqueue_profiling_summarize

        mock_task = MagicMock()
        with patch("tasks.profiling.run_summarize_task", mock_task):
            enqueue_profiling_summarize(
                avatar_id="avatar-1",
                user_id="user-1",
                force=False,
            )

        mock_task.apply_async.assert_called_once()
        call = mock_task.apply_async.call_args
        assert call.kwargs.get("queue") == "website"
        assert call.kwargs.get("args") == ["avatar-1", "user-1", False]

    def test_broker_failure_raises(self) -> None:
        from services.enqueue_profiling import EnqueueProfilingError, enqueue_profiling_summarize

        mock_task = MagicMock()
        mock_task.apply_async.side_effect = ConnectionError("redis down")
        with patch("tasks.profiling.run_summarize_task", mock_task):
            with pytest.raises(EnqueueProfilingError, match="Redis broker is unreachable"):
                enqueue_profiling_summarize(
                    avatar_id="avatar-1",
                    user_id="user-1",
                )


class TestProfilingSkip:
    def test_skip_when_completed_and_not_force(self) -> None:
        from tasks.profiling import _should_skip

        row = {
            "id": "avatar-1",
            "profiling_data": {"content_goal": {"answer": "x"}},
            "profile_summary_status": "completed",
            "profile_summary": "done summary",
            "profile_summary_source_hash": "hash-1",
            "website_summary_status": "skipped",
            "website_summary": None,
        }

        fake_website = MagicMock()
        fake_website.extract_website_url_from_profiling.return_value = None
        fake_website.website_url_hash = MagicMock(return_value="x")

        with (
            patch("db.supabase_client.assert_avatar_owned", return_value=row),
            patch(
                "context.profiling_data.profiling_data_hash",
                return_value="hash-1",
            ),
            patch.dict(
                "sys.modules",
                {
                    "services.website_summary": fake_website,
                    "clients.apify_website": MagicMock(website_url_hash=MagicMock()),
                },
            ),
        ):
            assert _should_skip(avatar_id="avatar-1", user_id="user-1", force=False) is True

    def test_force_does_not_skip(self) -> None:
        from tasks.profiling import _should_skip

        assert _should_skip(avatar_id="avatar-1", user_id="user-1", force=True) is False


class TestRedisHealth:
    def test_ping_up(self) -> None:
        with patch("services.redis_health.redis.Redis") as redis_cls:
            client = MagicMock()
            client.ping.return_value = True
            redis_cls.from_url.return_value = client
            from services.redis_health import ping_redis

            assert ping_redis() is True

    def test_ping_down(self) -> None:
        with patch("services.redis_health.redis.Redis") as redis_cls:
            redis_cls.from_url.side_effect = ConnectionError("down")
            from services.redis_health import ping_redis

            assert ping_redis() is False
