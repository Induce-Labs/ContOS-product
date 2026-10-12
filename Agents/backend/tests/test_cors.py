"""Agents CORS must stay an explicit origin list when credentials are enabled."""

from fastapi.middleware.cors import CORSMiddleware

import main


def test_cors_allows_explicit_origins_only() -> None:
    cors = next(
        middleware
        for middleware in main.app.user_middleware
        if middleware.cls is CORSMiddleware
    )
    origins = cors.kwargs["allow_origins"]
    assert isinstance(origins, list)
    assert origins
    assert "*" not in origins
    assert cors.kwargs["allow_credentials"] is True
    assert "http://localhost:5173" in origins
    assert "http://127.0.0.1:5173" in origins
