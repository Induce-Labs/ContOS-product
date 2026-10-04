"""GlitchTip monitoring for Agents web and the website worker."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from monitoring import before_send, capture_server_exception, init_glitchtip  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_monitoring_flag():
    import monitoring

    monitoring._initialized = False
    yield
    monitoring._initialized = False


def test_agents_celery_app_imports() -> None:
    import celery_app

    assert celery_app.celery_app.main == "contos_agents"
    assert celery_app.celery_app.conf.task_ignore_result is True
    assert celery_app.celery_app.conf.task_default_queue == "website"
    routes = celery_app.celery_app.conf.task_routes
    assert routes["profiling.run_summarize"]["queue"] == "website"
    assert routes["translate.translate_content"]["queue"] == "website"


def test_init_skipped_when_dsn_absent() -> None:
    with patch("monitoring.sentry_sdk.init") as init:
        init_glitchtip(dsn="", environment="development")
    init.assert_not_called()


def test_init_does_not_require_auth_token() -> None:
    with patch("monitoring.sentry_sdk.init") as init:
        init_glitchtip(dsn="https://public@glitchtip.example/2", environment="production")
    kwargs = init.call_args.kwargs
    assert kwargs["traces_sample_rate"] == 0.01
    assert kwargs["auto_session_tracking"] is False
    assert kwargs.get("enable_logs") is not True
    assert "SENTRY_AUTH_TOKEN" not in kwargs
    names = {type(item).__name__ for item in kwargs["integrations"]}
    assert "CeleryIntegration" in names
    assert "FastApiIntegration" in names


@pytest.mark.parametrize("status_code", [400, 401, 403, 404, 429])
def test_expected_client_status_is_not_captured(status_code: int) -> None:
    hint = {"exc_info": (HTTPException, HTTPException(status_code=status_code, detail="x"), None)}
    assert before_send({"message": "client"}, hint) is None


def test_unexpected_exception_is_kept_without_task_content() -> None:
    event = {
        "message": "summarize failed",
        "contexts": {
            "celery": {
                "task": "profiling.run_summarize",
                "args": ["avatar-9", "user-9"],
                "kwargs": {"text": "scraped website", "texts": ["prompt"]},
                "retries": 2,
            }
        },
    }
    result = before_send(event, {"exc_info": (RuntimeError, RuntimeError("summarize failed"), None)})
    assert result is not None
    job = result["contexts"]["celery"]
    assert "args" not in job
    assert "kwargs" not in job
    assert "scraped website" not in str(result)
    assert "prompt" not in str(result)
    assert result["tags"]["avatar_id"] == "avatar-9"
    assert result["tags"]["user_id"] == "user-9"
    assert result["tags"]["retry_count"] == "2"


def test_translate_task_does_not_keep_text() -> None:
    event = {
        "contexts": {
            "celery": {
                "task": "translate.translate_content",
                "args": ["es", "en", "generated post"],
                "kwargs": {"texts": ["do not send"]},
            }
        }
    }
    result = before_send(event, None)
    assert result is not None
    assert "generated post" not in str(result)
    assert "do not send" not in str(result)
    assert "args" not in result["contexts"]["celery"]


def test_upstream_message_drops_secrets() -> None:
    event = {
        "exception": {
            "values": [
                {
                    "value": (
                        "Bearer secret-bearer pos_agent_token "
                        "client_secret=oauth-secret CONTOS_PROVISION_SECRET=provision-value-zzz"
                    )
                }
            ]
        },
        "request": {
            "headers": {"Authorization": "Bearer secret-bearer"},
            "data": {"prompt": "hidden prompt"},
        },
        "contexts": {"response": {"status_code": 502}},
    }
    result = before_send(event, None)
    assert result is not None
    rendered = str(result)
    assert "secret-bearer" not in rendered
    assert "pos_agent_token" not in rendered
    assert "oauth-secret" not in rendered
    assert "provision-value-zzz" not in rendered
    assert "hidden prompt" not in rendered


def test_capture_reports_only_when_dsn_is_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    with patch("monitoring.sentry_sdk.capture_exception") as capture:
        capture_server_exception(RuntimeError("sse"))
    capture.assert_not_called()

    monkeypatch.setenv("SENTRY_DSN", "https://public@glitchtip.example/2")
    error = RuntimeError("sse")
    with patch("monitoring.sentry_sdk.capture_exception") as capture:
        capture_server_exception(error)
    capture.assert_called_once_with(error)
