"""GlitchTip monitoring: init is optional, expected 4xx is dropped, secrets are scrubbed."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.monitoring import before_send, capture_server_exception, init_glitchtip, redact_text


@pytest.fixture(autouse=True)
def _reset_monitoring_flag():
    import app.monitoring as monitoring

    monitoring._initialized = False
    yield
    monitoring._initialized = False


def test_backend_app_and_celery_import_without_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SENTRY_DSN", "")
    import app.celery_app as celery_app
    import app.main as main

    assert main.app.title == "ContOS API"
    assert celery_app.celery_app.main == "contos_backend"
    assert celery_app.celery_app.conf.task_ignore_result is True
    assert celery_app.celery_app.conf.task_default_queue == "scrape"


def test_init_skipped_when_dsn_absent() -> None:
    with patch("app.monitoring.sentry_sdk.init") as init:
        init_glitchtip(dsn="", environment="development")
    init.assert_not_called()


def test_init_uses_glitchtip_options_without_auth_token() -> None:
    with patch("app.monitoring.sentry_sdk.init") as init:
        init_glitchtip(
            dsn="https://public@glitchtip.example/1",
            environment="development",
        )
    kwargs = init.call_args.kwargs
    assert kwargs["dsn"] == "https://public@glitchtip.example/1"
    assert kwargs["environment"] == "development"
    assert kwargs["traces_sample_rate"] == 0.01
    assert kwargs["auto_session_tracking"] is False
    assert kwargs["send_default_pii"] is False
    assert kwargs["include_local_variables"] is False
    assert kwargs["max_request_body_size"] == "never"
    assert kwargs.get("enable_logs") is not True
    assert "SENTRY_AUTH_TOKEN" not in kwargs
    names = {type(item).__name__ for item in kwargs["integrations"]}
    assert {"FastApiIntegration", "CeleryIntegration", "StarletteIntegration"} <= names


@pytest.mark.parametrize("status_code", [400, 401, 404, 429])
def test_expected_client_status_is_not_captured(status_code: int) -> None:
    event = {"message": "client error", "exception": {"values": [{"value": "nope"}]}}
    hint = {"exc_info": (HTTPException, HTTPException(status_code=status_code, detail="x"), None)}
    assert before_send(event, hint) is None


def test_unexpected_exception_is_kept() -> None:
    event = {"message": "boom", "exception": {"values": [{"value": "database offline"}]}}
    result = before_send(event, {"exc_info": (RuntimeError, RuntimeError("database offline"), None)})
    assert result is not None
    assert result["exception"]["values"][0]["value"] == "database offline"


@pytest.mark.parametrize("status_code", [502, 503, 504])
def test_upstream_failure_is_captured_without_secrets(status_code: int) -> None:
    detail = (
        "upstream failed Bearer pos_token_secret "
        "access_token=oauth-access refresh_token=oauth-refresh "
        "client_secret=oauth-secret CONTOS_PROVISION_SECRET=provision-value-zzz "
        "POSTIZ_TOKEN_ENCRYPTION_KEY=fernet-key-zzz redis://user:pass@redis:6379/0"
    )
    event = {
        "request": {
            "url": "https://api.example/postiz?access_token=query-token&code=oauth-code",
            "headers": {"Authorization": "Bearer header-token", "Cookie": "session=abc"},
            "cookies": {"session": "abc"},
            "data": {"content": "post body", "password": "secret"},
        },
        "exception": {"values": [{"value": detail}]},
        "contexts": {"response": {"status_code": status_code}},
    }
    result = before_send(event, None)
    assert result is not None
    rendered = str(result)
    assert "pos_token_secret" not in rendered
    assert "oauth-access" not in rendered
    assert "oauth-refresh" not in rendered
    assert "oauth-secret" not in rendered
    assert "provision-value-zzz" not in rendered
    assert "fernet-key-zzz" not in rendered
    assert "header-token" not in rendered
    assert "query-token" not in rendered
    assert "oauth-code" not in rendered
    assert "post body" not in rendered
    assert "redis://user:pass@redis:6379/0" not in rendered
    assert "Authorization" not in result["request"]
    assert "headers" not in result["request"]
    assert "cookies" not in result["request"]
    assert "data" not in result["request"]


def test_celery_payload_is_stripped_and_safe_ids_tagged() -> None:
    event = {
        "tags": {"celery_task_name": "pipeline.run_competitor"},
        "contexts": {
            "celery": {
                "task": "pipeline.run_competitor",
                "args": ["avatar-1", "competitor-1"],
                "kwargs": {"text": "scraped page", "avatar_id": "avatar-1"},
                "retries": 1,
            }
        },
    }
    result = before_send(event, None)
    assert result is not None
    job = result["contexts"]["celery"]
    assert "args" not in job
    assert "kwargs" not in job
    assert "scraped page" not in str(result)
    assert result["tags"]["avatar_id"] == "avatar-1"
    assert result["tags"]["competitor_id"] == "competitor-1"
    assert result["tags"]["retry_count"] == "1"


def test_capture_is_noop_without_dsn(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    with patch("app.monitoring.sentry_sdk.capture_exception") as capture:
        capture_server_exception(RuntimeError("unexpected"))
    capture.assert_not_called()


def test_capture_reports_unexpected_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SENTRY_DSN", "https://public@glitchtip.example/1")
    error = RuntimeError("unexpected")
    with patch("app.monitoring.sentry_sdk.capture_exception") as capture:
        capture_server_exception(error)
    capture.assert_called_once_with(error)


def test_redact_text_covers_secret_shapes() -> None:
    raw = "Bearer abc pos_live token=abc password=hunter2 postgres://u:p@db/app"
    cleaned = redact_text(raw)
    assert "abc" not in cleaned.split("Bearer ", 1)[-1]
    assert "pos_live" not in cleaned
    assert "hunter2" not in cleaned
    assert "postgres://u:p@db/app" not in cleaned
