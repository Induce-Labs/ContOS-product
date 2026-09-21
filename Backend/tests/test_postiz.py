"""Postiz LinkedIn OAuth bridge tests."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.routes.postiz import OAuthCallbackRequest
from app.clients.postiz_client import PostizClient
from app.config import Settings
from app.errors import (
    PostizAuthorizationInvalidError,
    PostizOAuthStateError,
    PostizServiceError,
)
from app.services.postiz_oauth import PostizOAuthService, SafeChannel

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ENV_EXAMPLE = REPO_ROOT / "Frontend" / ".env.example"
MIGRATION = (
    REPO_ROOT / "supabase" / "migrations" / "20260921000000_postiz_connections.sql"
)

USER_A = UUID("11111111-1111-1111-1111-111111111111")
USER_B = UUID("22222222-2222-2222-2222-222222222222")


def _settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "service-role",
        "POSTIZ_URL": "https://postiz.contos.now",
        "POSTIZ_CLIENT_ID": "pca_test_client",
        "POSTIZ_CLIENT_SECRET": "pcs_test_secret",
        "POSTIZ_REDIRECT_URI": "http://localhost:5173/auth/postiz/callback",
        "POSTIZ_TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode("utf-8"),
        "REDIS_URL": "redis://localhost:6379/0",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def set(self, key: str, value: str, nx: bool = False, ex: int | None = None) -> bool:
        if nx and key in self.store:
            return False
        self.store[key] = value
        return True

    def get(self, key: str) -> str | None:
        return self.store.get(key)

    def delete(self, key: str) -> int:
        return 1 if self.store.pop(key, None) is not None else 0

    def eval(self, script: str, numkeys: int, key: str) -> str | None:
        value = self.store.get(key)
        if value is not None:
            del self.store[key]
        return value


def _service(
    *,
    settings: Settings | None = None,
    client: MagicMock | None = None,
    repository: MagicMock | None = None,
    redis_client: FakeRedis | None = None,
) -> PostizOAuthService:
    return PostizOAuthService(
        settings or _settings(),
        client=client or MagicMock(),
        repository=repository or MagicMock(),
        redis_client=redis_client or FakeRedis(),  # type: ignore[arg-type]
    )


class TestOAuthCallbackSchema:
    def test_accepts_code_and_state_only(self) -> None:
        body = OAuthCallbackRequest(code="abc", state="xyz")
        assert body.code == "abc"
        assert body.state == "xyz"

    def test_rejects_redirect_uri_and_unknown_fields(self) -> None:
        with pytest.raises(ValidationError):
            OAuthCallbackRequest.model_validate(
                {
                    "code": "abc",
                    "state": "xyz",
                    "redirect_uri": "https://evil.example/callback",
                },
            )
        with pytest.raises(ValidationError):
            OAuthCallbackRequest.model_validate(
                {
                    "code": "abc",
                    "state": "xyz",
                    "organization_id": "org-1",
                },
            )


class TestPostizClientParsing:
    def test_parse_token_response_exact_shape(self) -> None:
        client = PostizClient(_settings())
        parsed = client._parse_token_response(
            {
                "id": "org-123",
                "cus": None,
                "access_token": "pos_abcdefghijklmnopqrstuvwxyz0123456789abcd",
                "token_type": "bearer",
            },
        )
        assert parsed["id"] == "org-123"
        assert parsed["token_type"] == "bearer"
        assert parsed["access_token"].startswith("pos_")

    def test_rejects_malformed_token_response(self) -> None:
        client = PostizClient(_settings())
        with pytest.raises(PostizServiceError):
            client._parse_token_response({"access_token": "pos_x"})
        with pytest.raises(PostizServiceError):
            client._parse_token_response(
                {
                    "id": "org",
                    "access_token": "not-a-pos-token",
                    "token_type": "bearer",
                },
            )

    def test_rejects_disallowed_navigation_origin(self) -> None:
        client = PostizClient(_settings())
        with pytest.raises(PostizServiceError):
            client.validate_navigation_url("https://evil.example/phish")


class TestPostizOAuthService:
    def test_store_and_consume_state_once(self) -> None:
        redis_client = FakeRedis()
        service = _service(redis_client=redis_client)
        state = "state-value-one"
        service._store_oauth_state(state=state, contos_user_id=USER_A)
        key = f"postiz:oauth:state:{hashlib.sha256(state.encode()).hexdigest()}"
        assert key in redis_client.store

        consumed = service._consume_oauth_state(state)
        assert consumed == USER_A
        assert key not in redis_client.store

        with pytest.raises(PostizOAuthStateError):
            service._consume_oauth_state(state)

    def test_mismatched_state_user_rejected(self) -> None:
        redis_client = FakeRedis()
        client = MagicMock()
        repository = MagicMock()
        service = _service(
            client=client,
            repository=repository,
            redis_client=redis_client,
        )
        state = "state-user-a"
        service._store_oauth_state(state=state, contos_user_id=USER_A)

        with pytest.raises(PostizOAuthStateError):
            service.complete_oauth_callback(
                contos_user_id=USER_B,
                code="auth-code",
                state=state,
            )
        client.exchange_code_for_token.assert_not_called()

    def test_encrypt_roundtrip_and_no_plaintext_in_upsert(self) -> None:
        redis_client = FakeRedis()
        client = MagicMock()
        repository = MagicMock()
        settings = _settings()
        service = _service(
            settings=settings,
            client=client,
            repository=repository,
            redis_client=redis_client,
        )
        state = "state-ok"
        service._store_oauth_state(state=state, contos_user_id=USER_A)
        client.exchange_code_for_token.return_value = {
            "id": "org-a",
            "cus": None,
            "access_token": "pos_token_value_aaaaaaaaaaaaaaaaaaaaaaaa",
            "token_type": "bearer",
        }
        client.get_linkedin_authorization_url.return_value = (
            "https://www.linkedin.com/oauth/v2/authorization?response_type=code"
        )

        result = service.complete_oauth_callback(
            contos_user_id=USER_A,
            code="auth-code",
            state=state,
        )
        assert result.flow == "linkedin"
        upsert_kwargs = repository.upsert_connection.call_args.kwargs
        assert upsert_kwargs["contos_user_id"] == USER_A
        assert upsert_kwargs["postiz_organization_id"] == "org-a"
        encrypted = upsert_kwargs["encrypted_access_token"]
        assert "pos_token_value" not in encrypted
        decrypted = Fernet(settings.postiz_token_encryption_key.encode()).decrypt(
            encrypted.encode(),
        )
        assert decrypted.decode() == "pos_token_value_aaaaaaaaaaaaaaaaaaaaaaaa"

    def test_status_requires_enabled_linkedin_only(self) -> None:
        repository = MagicMock()
        client = MagicMock()
        settings = _settings()
        fernet = Fernet(settings.postiz_token_encryption_key.encode())
        repository.get_connection.return_value = {
            "encrypted_access_token": fernet.encrypt(b"pos_abc").decode(),
            "postiz_organization_id": "org-a",
        }
        client.list_integrations.return_value = [
            {
                "id": "ig-1",
                "name": "Page",
                "identifier": "linkedin-page",
                "disabled": False,
            },
            {
                "id": "li-1",
                "name": "Sheema",
                "identifier": "linkedin",
                "disabled": False,
            },
        ]
        service = _service(settings=settings, client=client, repository=repository)
        status = service.get_status(USER_A)
        assert status.connected is True
        assert status.channels == (
            SafeChannel(id="li-1", provider="linkedin", name="Sheema"),
        )

    def test_status_false_when_linkedin_disabled(self) -> None:
        repository = MagicMock()
        client = MagicMock()
        settings = _settings()
        fernet = Fernet(settings.postiz_token_encryption_key.encode())
        repository.get_connection.return_value = {
            "encrypted_access_token": fernet.encrypt(b"pos_abc").decode(),
            "postiz_organization_id": "org-a",
        }
        client.list_integrations.return_value = [
            {
                "id": "li-1",
                "name": "Sheema",
                "identifier": "linkedin",
                "disabled": True,
            },
        ]
        service = _service(settings=settings, client=client, repository=repository)
        assert service.get_status(USER_A).connected is False

    def test_user_isolation_repository_always_filtered(self) -> None:
        repository = MagicMock()
        repository.get_connection.return_value = None
        client = MagicMock()
        service = _service(client=client, repository=repository)
        service.get_status(USER_A)
        repository.get_connection.assert_called_once_with(USER_A)
        client.list_integrations.assert_not_called()

    def test_subsequent_connect_skips_consent_when_token_valid(self) -> None:
        repository = MagicMock()
        client = MagicMock()
        settings = _settings()
        fernet = Fernet(settings.postiz_token_encryption_key.encode())
        repository.get_connection.return_value = {
            "encrypted_access_token": fernet.encrypt(b"pos_existing").decode(),
            "postiz_organization_id": "org-a",
        }
        client.list_integrations.return_value = []
        client.get_linkedin_authorization_url.return_value = (
            "https://www.linkedin.com/oauth/v2/authorization?response_type=code"
        )
        service = _service(settings=settings, client=client, repository=repository)
        result = service.start_connect(USER_A)
        assert result.flow == "linkedin"
        assert "linkedin.com" in result.authorization_url

    def test_invalid_token_on_status_raises_reconnect_error(self) -> None:
        repository = MagicMock()
        client = MagicMock()
        settings = _settings()
        fernet = Fernet(settings.postiz_token_encryption_key.encode())
        repository.get_connection.return_value = {
            "encrypted_access_token": fernet.encrypt(b"pos_revoked").decode(),
            "postiz_organization_id": "org-a",
        }
        client.list_integrations.side_effect = PostizAuthorizationInvalidError(
            "Postiz authorization is no longer valid; reconnect required.",
        )
        service = _service(settings=settings, client=client, repository=repository)
        with pytest.raises(PostizAuthorizationInvalidError):
            service.get_status(USER_A)
        repository.delete_connection.assert_called_once_with(USER_A)

    def test_consent_url_uses_server_config_not_request_host(self) -> None:
        service = _service()
        url = service.build_postiz_consent_url("abc123")
        assert url.startswith("https://postiz.contos.now/oauth/authorize?")
        assert "client_id=pca_test_client" in url
        assert "response_type=code" in url
        assert "state=abc123" in url
        assert "returnUrl=" in url
        assert "localhost" not in url.split("returnUrl=")[0]


class TestPostizRoutesAuth:
    def test_unauthenticated_endpoints_return_401(self) -> None:
        from app.main import app

        client = TestClient(app)
        assert client.get("/api/postiz/status").status_code == 401
        assert client.get("/api/postiz/connect").status_code == 401
        assert (
            client.post(
                "/api/postiz/oauth/callback",
                json={"code": "x", "state": "y"},
            ).status_code
            == 401
        )

    def test_callback_rejects_extra_fields_with_422(self) -> None:
        from app.api.deps import get_current_user_id
        from app.main import app

        app.dependency_overrides[get_current_user_id] = lambda: USER_A
        try:
            client = TestClient(app)
            response = client.post(
                "/api/postiz/oauth/callback",
                json={
                    "code": "x",
                    "state": "y",
                    "redirect_uri": "https://evil.example",
                },
            )
            assert response.status_code == 422
        finally:
            app.dependency_overrides.clear()

    def test_status_never_returns_token(self) -> None:
        from app.api.deps import get_current_user_id
        from app.main import app

        from app.services.postiz_oauth import PostizStatus, SafeChannel

        fake_status = PostizStatus(
            connected=True,
            channels=(SafeChannel(id="li-1", provider="linkedin", name="Sheema"),),
        )

        app.dependency_overrides[get_current_user_id] = lambda: USER_A
        try:
            with patch("app.api.routes.postiz.PostizOAuthService") as service_cls:
                service_cls.return_value.get_status.return_value = fake_status
                client = TestClient(app)
                response = client.get("/api/postiz/status")
                assert response.status_code == 200
                body = response.json()
                assert body == {
                    "connected": True,
                    "channels": [
                        {"id": "li-1", "provider": "linkedin", "name": "Sheema"},
                    ],
                }
                dumped = json.dumps(body)
                assert "pos_" not in dumped
                assert "access_token" not in dumped
                assert "encrypted" not in dumped
        finally:
            app.dependency_overrides.clear()


class TestPostizMigrationAndSecrets:
    def test_migration_has_unique_user_and_rls_without_policies(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8")
        assert "CREATE TABLE IF NOT EXISTS public.postiz_connections" in sql
        assert "UNIQUE (contos_user_id)" in sql
        assert "ENABLE ROW LEVEL SECURITY" in sql
        assert "encrypted_access_token" in sql
        assert "CREATE POLICY" not in sql

    def test_frontend_env_has_no_postiz_secrets(self) -> None:
        content = FRONTEND_ENV_EXAMPLE.read_text(encoding="utf-8").upper()
        for token in (
            "POSTIZ_CLIENT_SECRET",
            "POSTIZ_TOKEN_ENCRYPTION_KEY",
            "PCS_",
            "SERVICE_ROLE",
        ):
            assert token not in content
