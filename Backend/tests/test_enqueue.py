"""Tests for Celery scrape enqueue and Redis health."""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

import app.tasks.pipeline as pipeline_mod
from app.services.enqueue import EnqueueError, enqueue_competitor_jobs
from app.services.redis_health import ping_redis


class TestEnqueueCompetitorJobs:
    def test_fan_out_one_task_per_competitor(self) -> None:
        avatar_id = uuid4()
        competitor_ids = [uuid4(), uuid4()]
        mock_task = MagicMock()

        with patch.object(pipeline_mod, "run_competitor_task", mock_task):
            enqueue_competitor_jobs(avatar_id, competitor_ids)

        assert mock_task.apply_async.call_count == 2
        published_ids = set()
        for call in mock_task.apply_async.call_args_list:
            args = call.kwargs.get("args")
            assert args is not None
            assert args[0] == str(avatar_id)
            published_ids.add(args[1])
            assert call.kwargs.get("queue") == "scrape"
        assert published_ids == {str(cid) for cid in competitor_ids}

    def test_broker_failure_raises_enqueue_error(self) -> None:
        mock_task = MagicMock()
        mock_task.apply_async.side_effect = ConnectionError("redis down")

        with patch.object(pipeline_mod, "run_competitor_task", mock_task):
            with pytest.raises(EnqueueError, match="Redis broker is unreachable"):
                enqueue_competitor_jobs(uuid4(), [uuid4()])

    def test_empty_list_is_noop(self) -> None:
        mock_task = MagicMock()
        with patch.object(pipeline_mod, "run_competitor_task", mock_task):
            enqueue_competitor_jobs(uuid4(), [])
        mock_task.apply_async.assert_not_called()


class TestRedisHealth:
    def test_ping_redis_up(self) -> None:
        with patch("app.services.redis_health.redis.Redis") as redis_cls:
            client = MagicMock()
            client.ping.return_value = True
            redis_cls.from_url.return_value = client
            assert ping_redis() is True

    def test_ping_redis_down(self) -> None:
        with patch("app.services.redis_health.redis.Redis") as redis_cls:
            redis_cls.from_url.side_effect = ConnectionError("down")
            assert ping_redis() is False


class TestCompetitorTaskSkip:
    def test_skips_when_already_done(self) -> None:
        avatar_id = str(uuid4())
        competitor_id = str(uuid4())
        repository = MagicMock()
        repository.get_competitors_for_avatar.return_value = [
            {"id": competitor_id, "pipeline_step": "done"},
        ]

        with (
            patch.object(pipeline_mod, "acquire_job_lock") as lock_cm,
            patch(
                "app.clients.supabase_repo.SupabaseRepository",
                return_value=repository,
            ),
            patch("app.services.pipeline.run_competitor_job") as run_job,
        ):
            lock_cm.return_value.__enter__.return_value = True
            lock_cm.return_value.__exit__.return_value = None
            pipeline_mod._run_locked(avatar_id=avatar_id, competitor_id=competitor_id)
            run_job.assert_not_called()

    def test_skips_when_lock_not_acquired(self) -> None:
        with (
            patch.object(pipeline_mod, "acquire_job_lock") as lock_cm,
            patch.object(pipeline_mod, "_run_locked") as run_locked,
        ):
            lock_cm.return_value.__enter__.return_value = False
            lock_cm.return_value.__exit__.return_value = None
            pipeline_mod.run_competitor_task.run(str(uuid4()), str(uuid4()))
            run_locked.assert_not_called()
