"""CORS allow-list for the local Vite origin, including unhandled 500 responses."""

from unittest.mock import patch
from uuid import UUID

from fastapi.testclient import TestClient

from app.api.deps import get_current_user_id
from app.main import app

ORIGIN = "http://localhost:5173"
AVATAR_ID = "53e1c9df-0b67-461d-8b02-5a14dfb9c9b0"
USER_ID = UUID("5737af92-0404-4013-bc4d-79e671bf3114")
STATUS_PATHS = (
    f"/api/postiz/status?avatar_id={AVATAR_ID}",
    f"/api/postiz/status?avatar_id={AVATAR_ID}&platform=x",
)


def _assert_localhost_cors(response) -> None:
    allow_origin = response.headers["access-control-allow-origin"]
    assert allow_origin == ORIGIN
    assert allow_origin != "*"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_preflight_status_allows_localhost_for_linkedin_and_x() -> None:
    client = TestClient(app)
    for path in STATUS_PATHS:
        response = client.options(
            path,
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
        )
        assert response.status_code == 200
        _assert_localhost_cors(response)


def test_status_get_allows_localhost_when_unauthorized() -> None:
    client = TestClient(app)
    for path in STATUS_PATHS:
        response = client.get(path, headers={"Origin": ORIGIN})
        assert response.status_code == 401
        _assert_localhost_cors(response)


def test_disallowed_origin_is_not_reflected() -> None:
    client = TestClient(app)
    response = client.get(
        STATUS_PATHS[0],
        headers={"Origin": "https://evil.example"},
    )
    assert "access-control-allow-origin" not in response.headers


def test_unhandled_status_error_still_allows_localhost() -> None:
    app.dependency_overrides[get_current_user_id] = lambda: USER_ID
    try:
        with (
            patch("app.api.routes.postiz._verify_avatar_owner"),
            patch("app.api.routes.postiz._get_service") as service_factory,
        ):
            service_factory.return_value.get_status.side_effect = RuntimeError("boom")
            service_factory.return_value.get_x_status.side_effect = RuntimeError("boom")
            client = TestClient(app)
            for path in STATUS_PATHS:
                response = client.get(path, headers={"Origin": ORIGIN})
                assert response.status_code == 500
                _assert_localhost_cors(response)
                assert response.json()["detail"] == "Internal server error"
    finally:
        app.dependency_overrides.clear()
