"""Temporary tests for the Supermemory connectivity probe."""

from __future__ import annotations

import sys
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import UUID

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from services.supermemory_diagnostics import probe_supermemory

FAKE_KEY = "test-supermemory-key-do-not-leak"
ADMIN_ID = UUID("00000000-0000-4000-8000-000000000001")
OTHER_ID = UUID("00000000-0000-4000-8000-000000000099")


@pytest.fixture
def agents_app() -> Iterator[FastAPI]:
    """Yield the shared app and always clear dependency overrides afterward."""
    import main

    main.app.dependency_overrides.clear()
    try:
        yield main.app
    finally:
        main.app.dependency_overrides.clear()


def _client_returning(result: httpx.Response | Exception) -> MagicMock:
    client = MagicMock()
    client.__enter__.return_value = client
    if isinstance(result, Exception):
        client.get.side_effect = result
    else:
        client.get.return_value = result
    return client


def test_probe_connected_on_2xx(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example/")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", FAKE_KEY)
    response = httpx.Response(
        200,
        request=httpx.Request("GET", "https://memory.example/v3/projects"),
    )
    client = _client_returning(response)
    with patch(
        "services.supermemory_diagnostics.httpx.Client",
        return_value=client,
    ) as constructor:
        result = probe_supermemory()

    constructor.assert_called_once_with(timeout=20.0, follow_redirects=False)
    called_url = client.get.call_args.args[0]
    called_headers = client.get.call_args.kwargs["headers"]
    assert called_url == "https://memory.example/v3/projects"
    assert called_headers["Authorization"] == f"Bearer {FAKE_KEY}"
    assert result == {"connected": True, "status_code": 200, "error": None}
    assert FAKE_KEY not in str(result)


def test_probe_non_2xx_does_not_leak_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", FAKE_KEY)
    response = httpx.Response(
        401,
        request=httpx.Request("GET", "https://memory.example/v3/projects"),
    )
    client = _client_returning(response)
    with patch("services.supermemory_diagnostics.httpx.Client", return_value=client):
        result = probe_supermemory()

    assert result["connected"] is False
    assert result["status_code"] == 401
    assert result["error"] == "Supermemory returned HTTP 401."
    assert FAKE_KEY not in result["error"]


def test_probe_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", FAKE_KEY)
    client = _client_returning(httpx.TimeoutException("slow"))
    with patch("services.supermemory_diagnostics.httpx.Client", return_value=client):
        result = probe_supermemory()

    assert result == {
        "connected": False,
        "status_code": None,
        "error": "Supermemory request timed out.",
    }
    assert FAKE_KEY not in result["error"]


def test_probe_connection_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPERMEMORY_BASE_URL", "https://memory.example")
    monkeypatch.setenv("SUPERMEMORY_API_KEY", FAKE_KEY)
    client = _client_returning(httpx.ConnectError("refused"))
    with patch("services.supermemory_diagnostics.httpx.Client", return_value=client):
        result = probe_supermemory()

    assert result["connected"] is False
    assert result["status_code"] is None
    assert result["error"] == "Supermemory connection failed."


def test_probe_missing_env_does_not_call_http(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SUPERMEMORY_BASE_URL", raising=False)
    monkeypatch.delenv("SUPERMEMORY_API_KEY", raising=False)
    with patch("services.supermemory_diagnostics.httpx.Client") as constructor:
        result = probe_supermemory()

    constructor.assert_not_called()
    assert result["connected"] is False
    assert result["status_code"] is None
    assert result["error"] is not None
    assert "SUPERMEMORY_BASE_URL" in result["error"]


def test_route_requires_authentication(agents_app: FastAPI) -> None:
    with patch("auth._dev_bypass_user_id", return_value=None):
        response = TestClient(agents_app).get("/api/diagnostics/supermemory")

    assert response.status_code == 401
    assert agents_app.dependency_overrides == {}


def test_route_rejects_non_admin(
    agents_app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import main

    monkeypatch.setenv("LLM_ENV", "prod")
    monkeypatch.setenv("AGENTS_ADMIN_USER_IDS", str(OTHER_ID))
    agents_app.dependency_overrides[main.get_current_user_id] = lambda: ADMIN_ID
    response = TestClient(agents_app).get("/api/diagnostics/supermemory")

    assert response.status_code == 403


def test_route_returns_probe_for_admin(
    agents_app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import main

    assert agents_app.dependency_overrides == {}
    monkeypatch.setenv("LLM_ENV", "prod")
    monkeypatch.setenv("AGENTS_ADMIN_USER_IDS", str(ADMIN_ID))
    agents_app.dependency_overrides[main.get_current_user_id] = lambda: ADMIN_ID
    payload = {"connected": True, "status_code": 200, "error": None}
    with patch(
        "services.supermemory_diagnostics.probe_supermemory",
        return_value=payload,
    ):
        response = TestClient(agents_app).get("/api/diagnostics/supermemory")

    assert response.status_code == 200
    assert response.json() == payload


def test_dependency_overrides_do_not_leak(agents_app: FastAPI) -> None:
    assert agents_app.dependency_overrides == {}
