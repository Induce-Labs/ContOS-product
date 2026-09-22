"""Postiz LinkedIn bridge tests (avatar-scoped Approach B)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.clients.postiz_client import PostizClient, is_provision_rotate_required_conflict
from app.config import Settings
from app.errors import (
    PostizAuthorizationInvalidError,
    PostizIntegrationClaimError,
    PostizNotConnectedError,
    PostizPostNotFoundError,
    PostizServiceError,
)
from app.services.postiz_oauth import PostizOAuthService, PostizStatus, SafeIntegration
from app.services.postiz_posts import PostizPostsService

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ENV_EXAMPLE = REPO_ROOT / "Frontend" / ".env.example"
BACKEND_ENV_EXAMPLE = REPO_ROOT / "Backend" / ".env.example"
MIGRATION = (
    REPO_ROOT / "supabase" / "migrations" / "20260921000000_postiz_connections.sql"
)
MIGRATION_INTEGRATION_ID = (
    REPO_ROOT / "supabase" / "migrations" / "20260921010000_postiz_integration_id.sql"
)
MIGRATION_AVATAR_SCOPE = (
    REPO_ROOT
    / "supabase"
    / "migrations"
    / "20260922000000_postiz_connections_avatar_scope.sql"
)

USER_A = UUID("11111111-1111-1111-1111-111111111111")
USER_B = UUID("22222222-2222-2222-2222-222222222222")
AVATAR_A = UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
AVATAR_B = UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
AVATAR_C = UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")


def _settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "SUPABASE_URL": "https://example.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "service-role",
        "POSTIZ_URL": "https://postiz.contos.now",
        "CONTOS_PROVISION_SECRET": "provision-secret-test",
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


def _connection(
    *,
    settings: Settings,
    token: bytes = b"pos_abc",
    user_id: UUID = USER_A,
    avatar_id: UUID = AVATAR_A,
    org_id: str = "org-a",
    integration_id: str | None = None,
) -> dict[str, Any]:
    fernet = Fernet(settings.postiz_token_encryption_key.encode())
    return {
        "contos_user_id": str(user_id),
        "avatar_id": str(avatar_id),
        "encrypted_access_token": fernet.encrypt(token).decode(),
        "postiz_organization_id": org_id,
        "postiz_integration_id": integration_id,
    }


class TestProvisionRotateDetection:
    def test_rotate_required_on_missing_token_409(self) -> None:
        assert is_provision_rotate_required_conflict(
            409,
            {
                "msg": (
                    "Provisioned avatar has no valid access token. "
                    "Call POST /internal/contos/rotate-avatar-token."
                ),
            },
        )

    def test_other_409_does_not_trigger_rotate(self) -> None:
        assert not is_provision_rotate_required_conflict(
            409,
            {"msg": "Some other conflict"},
        )
        assert not is_provision_rotate_required_conflict(400, {"msg": "no valid access token"})

    def test_provision_secret_whitespace_normalized(self) -> None:
        spaced = "abcd" + (" " * 20) + ("0123456789abcdef" * 3) + "0123456789ab"
        assert len("".join(spaced.split())) == 64
        settings = _settings(CONTOS_PROVISION_SECRET=spaced)
        assert " " not in settings.contos_provision_secret
        assert len(settings.contos_provision_secret) == 64

    def test_provision_401_is_not_linkedin_reconnect_error(self) -> None:
        from app.errors import ConfigurationError

        settings = _settings()
        client = PostizClient(settings)

        class FakeResponse:
            status_code = 401
            text = '{"msg":"Unauthorized"}'

            def json(self) -> dict[str, str]:
                return {"msg": "Unauthorized"}

        with patch("app.clients.postiz_client.httpx.Client") as client_cls:
            instance = client_cls.return_value.__enter__.return_value
            instance.request.return_value = FakeResponse()
            with pytest.raises(ConfigurationError, match="CONTOS_PROVISION_SECRET"):
                client.provision_avatar(AVATAR_A)


class TestPostizClientNavigation:
    def test_rejects_disallowed_navigation_origin(self) -> None:
        client = PostizClient(_settings())
        with pytest.raises(PostizServiceError):
            client.validate_navigation_url("https://evil.example/phish")

    def test_provision_rotates_only_on_expected_409(self) -> None:
        settings = _settings()
        client = PostizClient(settings)
        with patch.object(client, "_request_json") as request_json:
            rotate_error = PostizServiceError("rotate required")
            setattr(rotate_error, "rotate_required", True)
            request_json.side_effect = [
                rotate_error,
                {
                    "organization_id": "org-rotated",
                    "created": False,
                    "access_token": "pos_rotated_token_aaaaaaaaaaaaaaaaaaaa",
                },
            ]
            result = client.provision_avatar(AVATAR_A)
            assert result["organization_id"] == "org-rotated"
            assert request_json.call_count == 2

    def test_provision_propagates_other_409(self) -> None:
        settings = _settings()
        client = PostizClient(settings)
        with patch.object(client, "_request_json") as request_json:
            request_json.side_effect = PostizServiceError(
                "Postiz request failed with status 409: other conflict",
            )
            with pytest.raises(PostizServiceError, match="409"):
                client.provision_avatar(AVATAR_A)


class TestPostizOAuthService:
    def test_encrypt_roundtrip_and_no_plaintext_in_upsert(self) -> None:
        client = MagicMock()
        repository = MagicMock()
        settings = _settings()
        repository.get_connection.return_value = None
        client.provision_avatar.return_value = {
            "organization_id": "org-a",
            "created": True,
            "access_token": "pos_token_value_aaaaaaaaaaaaaaaaaaaaaaaa",
        }
        client.list_integrations.return_value = []
        client.get_linkedin_authorization_url.return_value = (
            "https://www.linkedin.com/oauth/v2/authorization?response_type=code"
        )
        repository.upsert_connection.side_effect = (
            lambda **kwargs: {
                "contos_user_id": str(kwargs["contos_user_id"]),
                "avatar_id": str(kwargs["avatar_id"]),
                "postiz_organization_id": kwargs["postiz_organization_id"],
                "encrypted_access_token": kwargs["encrypted_access_token"],
                "postiz_integration_id": None,
            }
        )
        service = _service(settings=settings, client=client, repository=repository)
        result = service.start_connect(contos_user_id=USER_A, avatar_id=AVATAR_A)
        assert result.flow == "linkedin"
        upsert_kwargs = repository.upsert_connection.call_args.kwargs
        assert upsert_kwargs["avatar_id"] == AVATAR_A
        assert upsert_kwargs["contos_user_id"] == USER_A
        encrypted = upsert_kwargs["encrypted_access_token"]
        assert "pos_token_value" not in encrypted
        decrypted = Fernet(settings.postiz_token_encryption_key.encode()).decrypt(
            encrypted.encode(),
        )
        assert decrypted.decode() == "pos_token_value_aaaaaaaaaaaaaaaaaaaaaaaa"

    def test_avatar_isolation_status_uses_only_that_avatar(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            avatar_id=AVATAR_A,
            integration_id="li-a",
            token=b"pos_token_a",
        )
        client.list_integrations.return_value = [
            {
                "id": "li-a",
                "name": "Avatar A",
                "identifier": "linkedin",
                "disabled": False,
            },
        ]
        service = _service(settings=settings, client=client, repository=repository)
        status = service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_A)
        assert status.connected is True
        assert status.integration is not None
        assert status.integration.id == "li-a"
        repository.get_connection.assert_called_once_with(AVATAR_A)

    def test_status_never_reads_other_avatar_connection(self) -> None:
        repository = MagicMock()
        repository.get_connection.return_value = None
        service = _service(repository=repository)
        status = service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_B)
        assert status.connected is False
        repository.get_connection.assert_called_once_with(AVATAR_B)

    def test_status_returns_only_stored_integration(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            integration_id="li-sheema",
        )
        client.list_integrations.return_value = [
            {
                "id": "li-sarah",
                "name": "sarah moiz",
                "identifier": "linkedin",
                "disabled": False,
            },
            {
                "id": "li-sheema",
                "name": "Sheema Bakhtiar",
                "identifier": "linkedin",
                "disabled": False,
                "picture": "https://example.com/sheema.jpg",
            },
        ]
        service = _service(settings=settings, client=client, repository=repository)
        status = service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_A)
        assert status.connected is True
        assert status.integration == SafeIntegration(
            id="li-sheema",
            name="Sheema Bakhtiar",
            identifier="linkedin",
            picture="https://example.com/sheema.jpg",
        )

    def test_status_false_without_guessing_when_unbound_and_multiple_linkedin(
        self,
    ) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(settings=settings)
        repository.get_connection_by_integration_id.return_value = None
        client.list_integrations.return_value = [
            {
                "id": "li-1",
                "name": "Sheema",
                "identifier": "linkedin",
                "disabled": False,
            },
            {
                "id": "li-2",
                "name": "Other",
                "identifier": "linkedin",
                "disabled": False,
            },
        ]
        service = _service(settings=settings, client=client, repository=repository)
        status = service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_A)
        assert status.connected is False
        assert status.claim_candidates == ()
        repository.claim_integration.assert_not_called()

    def test_status_returns_claim_candidates_when_snapshot_ambiguous(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(settings=settings)
        repository.get_connection_by_integration_id.return_value = None
        integrations = [
            {
                "id": "li-1",
                "name": "Sheema",
                "identifier": "linkedin",
                "disabled": False,
            },
            {
                "id": "li-2",
                "name": "Other",
                "identifier": "linkedin",
                "disabled": False,
            },
        ]
        client.list_integrations.return_value = integrations
        service = _service(settings=settings, client=client, repository=repository)
        service._store_linkedin_snapshot(AVATAR_A, integrations)
        service._set_status_cache(
            AVATAR_A,
            PostizStatus(connected=False, integration=None),
        )
        status = service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_A)
        assert [c.id for c in status.claim_candidates] == ["li-1", "li-2"]
        repository.claim_integration.assert_not_called()

    def test_manual_claim_binds_selected_integration(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(settings=settings)
        repository.get_connection_by_integration_id.return_value = None
        repository.claim_integration.return_value = {
            "avatar_id": str(AVATAR_A),
            "postiz_integration_id": "li-1",
        }
        integrations = [
            {
                "id": "li-1",
                "name": "Sheema",
                "identifier": "linkedin",
                "disabled": False,
            },
            {
                "id": "li-2",
                "name": "Other",
                "identifier": "linkedin",
                "disabled": False,
            },
        ]
        client.list_integrations.return_value = integrations
        service = _service(settings=settings, client=client, repository=repository)
        service._store_linkedin_snapshot(AVATAR_A, integrations)
        status = service.claim_linkedin_integration(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            integration_id="li-1",
        )
        assert status.connected is True
        repository.claim_integration.assert_called_once_with(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            postiz_integration_id="li-1",
        )

    def test_claim_rejects_integration_owned_by_other_avatar(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(settings=settings)
        repository.get_connection_by_integration_id.return_value = {
            "avatar_id": str(AVATAR_B),
            "contos_user_id": str(USER_A),
            "postiz_integration_id": "li-1",
        }
        client.list_integrations.return_value = [
            {
                "id": "li-1",
                "name": "Sheema",
                "identifier": "linkedin",
                "disabled": False,
            },
        ]
        service = _service(settings=settings, client=client, repository=repository)
        service._store_linkedin_snapshot(AVATAR_A, [])
        with pytest.raises(PostizIntegrationClaimError):
            service.claim_linkedin_integration(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                integration_id="li-1",
            )

    def test_claim_exactly_one_new_unclaimed_integration(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(settings=settings)
        repository.get_connection_by_integration_id.return_value = None
        repository.claim_integration.return_value = {
            "avatar_id": str(AVATAR_A),
            "postiz_integration_id": "li-new",
        }
        client.list_integrations.return_value = [
            {
                "id": "li-old",
                "name": "Old",
                "identifier": "linkedin",
                "disabled": False,
            },
            {
                "id": "li-new",
                "name": "Sheema",
                "identifier": "linkedin",
                "disabled": False,
            },
        ]
        service = _service(settings=settings, client=client, repository=repository)
        service._store_linkedin_snapshot(
            AVATAR_A,
            [
                {
                    "id": "li-old",
                    "name": "Old",
                    "identifier": "linkedin",
                    "disabled": False,
                },
            ],
        )
        status = service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_A)
        assert status.connected is True
        assert status.integration is not None
        assert status.integration.id == "li-new"

    def test_ensure_reuses_existing_valid_connection(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        existing = _connection(settings=settings, token=b"pos_existing")
        repository.get_connection.return_value = existing
        client.list_integrations.return_value = []
        service = _service(settings=settings, client=client, repository=repository)
        result = service.ensure_avatar_connection(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
        )
        assert result is existing
        client.provision_avatar.assert_not_called()

    def test_ensure_provisions_when_missing(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = None
        client.provision_avatar.return_value = {
            "organization_id": "org-new",
            "created": True,
            "access_token": "pos_new_token_bbbbbbbbbbbbbbbbbbbbbbbb",
        }
        repository.upsert_connection.return_value = {
            "avatar_id": str(AVATAR_A),
            "postiz_organization_id": "org-new",
        }
        service = _service(settings=settings, client=client, repository=repository)
        service.ensure_avatar_connection(contos_user_id=USER_A, avatar_id=AVATAR_A)
        client.provision_avatar.assert_called_once_with(AVATAR_A)
        assert repository.upsert_connection.call_args.kwargs["avatar_id"] == AVATAR_A

    def test_subsequent_connect_returns_linkedin_flow(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            token=b"pos_existing",
            integration_id="li-1",
        )
        client.list_integrations.return_value = []
        client.get_linkedin_authorization_url.return_value = (
            "https://www.linkedin.com/oauth/v2/authorization?response_type=code"
        )
        service = _service(settings=settings, client=client, repository=repository)
        result = service.start_connect(contos_user_id=USER_A, avatar_id=AVATAR_A)
        assert result.flow == "linkedin"
        assert "linkedin.com" in result.authorization_url

    def test_invalid_token_on_status_raises_reconnect_error(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            token=b"pos_revoked",
            integration_id="li-1",
        )
        client.list_integrations.side_effect = PostizAuthorizationInvalidError(
            "Postiz authorization is no longer valid; reconnect required.",
        )
        service = _service(settings=settings, client=client, repository=repository)
        with pytest.raises(PostizAuthorizationInvalidError):
            service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_A)
        repository.delete_connection.assert_called_once_with(AVATAR_A)

    def test_legacy_null_avatar_not_returned_by_get_connection(self) -> None:
        """Repository get_connection filters by avatar_id — never legacy null rows."""
        repository = MagicMock()
        repository.get_connection.return_value = None
        service = _service(repository=repository)
        status = service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_A)
        assert status.connected is False
        repository.get_connection.assert_called_with(AVATAR_A)


class TestPostizRoutesAuth:
    def test_unauthenticated_endpoints_return_401(self) -> None:
        from app.main import app

        client = TestClient(app)
        assert (
            client.get(f"/api/postiz/status?avatar_id={AVATAR_A}").status_code == 401
        )
        assert (
            client.get(f"/api/postiz/connect?avatar_id={AVATAR_A}").status_code == 401
        )
        assert client.post("/api/postiz/oauth/callback").status_code == 401

    def test_oauth_callback_gone(self) -> None:
        from app.api.deps import get_current_user_id
        from app.main import app

        app.dependency_overrides[get_current_user_id] = lambda: USER_A
        try:
            client = TestClient(app)
            response = client.post("/api/postiz/oauth/callback")
            assert response.status_code == 410
        finally:
            app.dependency_overrides.clear()

    def test_status_requires_avatar_id(self) -> None:
        from app.api.deps import get_current_user_id
        from app.main import app

        app.dependency_overrides[get_current_user_id] = lambda: USER_A
        try:
            client = TestClient(app)
            assert client.get("/api/postiz/status").status_code == 422
        finally:
            app.dependency_overrides.clear()

    def test_status_rejects_unowned_avatar(self) -> None:
        from app.api.deps import get_current_user_id
        from app.errors import RepositoryError
        from app.main import app

        app.dependency_overrides[get_current_user_id] = lambda: USER_A
        try:
            with patch("app.api.routes.postiz.SupabaseRepository") as repo_cls:
                repo_cls.return_value.verify_avatar_owner.side_effect = RepositoryError(
                    "Avatar not found or you do not have permission to access it.",
                )
                client = TestClient(app)
                response = client.get(f"/api/postiz/status?avatar_id={AVATAR_B}")
                assert response.status_code == 404
        finally:
            app.dependency_overrides.clear()

    def test_status_never_returns_token(self) -> None:
        from app.api.deps import get_current_user_id
        from app.main import app

        fake_status = PostizStatus(
            connected=True,
            integration=SafeIntegration(
                id="li-1",
                name="Sheema",
                identifier="linkedin",
                picture=None,
            ),
        )

        app.dependency_overrides[get_current_user_id] = lambda: USER_A
        try:
            with (
                patch("app.api.routes.postiz.SupabaseRepository") as repo_cls,
                patch("app.api.routes.postiz.PostizOAuthService") as service_cls,
            ):
                repo_cls.return_value.verify_avatar_owner.return_value = None
                service_cls.return_value.get_status.return_value = fake_status
                client = TestClient(app)
                response = client.get(f"/api/postiz/status?avatar_id={AVATAR_A}")
                assert response.status_code == 200
                body = response.json()
                dumped = json.dumps(body)
                assert "pos_" not in dumped
                assert "access_token" not in dumped
                assert "encrypted" not in dumped
                service_cls.return_value.get_status.assert_called_once_with(
                    contos_user_id=USER_A,
                    avatar_id=AVATAR_A,
                )
        finally:
            app.dependency_overrides.clear()


class TestPostizRepositoryClaim:
    def test_claim_idempotent_for_same_avatar(self) -> None:
        from app.clients.postiz_repository import PostizRepository

        repo = PostizRepository.__new__(PostizRepository)
        repo._client = MagicMock()
        existing = {
            "contos_user_id": str(USER_A),
            "avatar_id": str(AVATAR_A),
            "postiz_integration_id": "li-1",
        }
        repo.get_connection = MagicMock(return_value=existing)  # type: ignore[method-assign]
        repo.get_connection_by_integration_id = MagicMock(return_value=None)  # type: ignore[method-assign]

        result = PostizRepository.claim_integration(
            repo,
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            postiz_integration_id="li-1",
        )
        assert result == existing
        repo._client.table.assert_not_called()

    def test_claim_rejects_other_avatar_owner(self) -> None:
        from app.clients.postiz_repository import PostizRepository

        repo = PostizRepository.__new__(PostizRepository)
        repo._client = MagicMock()
        repo.get_connection = MagicMock(  # type: ignore[method-assign]
            return_value={
                "contos_user_id": str(USER_A),
                "avatar_id": str(AVATAR_A),
                "postiz_integration_id": None,
            },
        )
        repo.get_connection_by_integration_id = MagicMock(  # type: ignore[method-assign]
            return_value={
                "contos_user_id": str(USER_A),
                "avatar_id": str(AVATAR_B),
                "postiz_integration_id": "li-1",
            },
        )
        with pytest.raises(PostizIntegrationClaimError):
            PostizRepository.claim_integration(
                repo,
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                postiz_integration_id="li-1",
            )

    def test_upsert_requires_avatar_and_never_updates_legacy_path(self) -> None:
        from app.clients.postiz_repository import PostizRepository

        repo = PostizRepository.__new__(PostizRepository)
        repo._client = MagicMock()
        # get_connection by avatar returns None — insert path, not legacy update.
        repo.get_connection = MagicMock(return_value=None)  # type: ignore[method-assign]
        insert_chain = MagicMock()
        insert_chain.execute.return_value = MagicMock(
            data=[
                {
                    "avatar_id": str(AVATAR_A),
                    "contos_user_id": str(USER_A),
                },
            ],
        )
        repo._client.table.return_value.insert.return_value = insert_chain

        PostizRepository.upsert_connection(
            repo,
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            postiz_organization_id="org-a",
            encrypted_access_token="enc",
        )
        insert_payload = repo._client.table.return_value.insert.call_args.args[0]
        assert insert_payload["avatar_id"] == str(AVATAR_A)
        assert insert_payload["avatar_id"] is not None


class TestPostizMigrationAndSecrets:
    def test_legacy_migration_has_user_unique_and_rls(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8")
        assert "CREATE TABLE IF NOT EXISTS public.postiz_connections" in sql
        assert "UNIQUE (contos_user_id)" in sql
        assert "ENABLE ROW LEVEL SECURITY" in sql
        assert "CREATE POLICY" not in sql

    def test_integration_id_migration_has_partial_unique_index(self) -> None:
        sql = MIGRATION_INTEGRATION_ID.read_text(encoding="utf-8")
        assert "postiz_connections_postiz_integration_id_unique" in sql

    def test_avatar_scope_migration(self) -> None:
        sql = MIGRATION_AVATAR_SCOPE.read_text(encoding="utf-8")
        assert "REFERENCES public.avatars (id) ON DELETE CASCADE" in sql
        assert "DROP CONSTRAINT IF EXISTS postiz_connections_contos_user_id_unique" in sql
        assert "postiz_connections_avatar_id_unique" in sql
        assert "WHERE avatar_id IS NOT NULL" in sql
        assert "postiz_connections_postiz_organization_id_unique" in sql
        assert "duplicate organization IDs exist" in sql
        assert "RAISE EXCEPTION" in sql

    def test_frontend_env_has_no_postiz_secrets(self) -> None:
        content = FRONTEND_ENV_EXAMPLE.read_text(encoding="utf-8").upper()
        for token in (
            "POSTIZ_CLIENT_SECRET",
            "POSTIZ_TOKEN_ENCRYPTION_KEY",
            "CONTOS_PROVISION_SECRET",
            "PCS_",
            "SERVICE_ROLE",
        ):
            assert token not in content

    def test_backend_env_example_documents_provision_secret(self) -> None:
        content = BACKEND_ENV_EXAMPLE.read_text(encoding="utf-8")
        assert "CONTOS_PROVISION_SECRET=" in content


def _posts_service(
    *,
    settings: Settings | None = None,
    client: MagicMock | None = None,
    repository: MagicMock | None = None,
) -> PostizPostsService:
    resolved = settings or _settings()
    mock_client = client or MagicMock()
    mock_repo = repository or MagicMock()
    oauth = _service(settings=resolved, client=mock_client, repository=mock_repo)
    return PostizPostsService(
        resolved,
        oauth=oauth,
        client=mock_client,
        repository=mock_repo,
    )


def _raw_post(
    *,
    post_id: str,
    content: str,
    integration_id: str,
    state: str = "QUEUE",
    publish_date: str = "2026-09-23T10:00:00.000Z",
) -> dict[str, Any]:
    return {
        "id": post_id,
        "content": content,
        "publishDate": publish_date,
        "state": state,
        "group": f"group-{post_id}",
        "releaseURL": None,
        "integration": {
            "id": integration_id,
            "name": f"LinkedIn {integration_id}",
            "providerIdentifier": "linkedin",
        },
    }


class TestPostizCalendarPosts:
    """Avatar-scoped calendar / publish / disconnect isolation."""

    def test_same_user_avatar_abc_list_isolation(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()

        connections = {
            AVATAR_A: _connection(
                settings=settings,
                avatar_id=AVATAR_A,
                org_id="org-a",
                integration_id="li-a",
                token=b"pos_token_a",
            ),
            AVATAR_B: _connection(
                settings=settings,
                avatar_id=AVATAR_B,
                org_id="org-b",
                integration_id="li-b",
                token=b"pos_token_b",
            ),
            AVATAR_C: _connection(
                settings=settings,
                avatar_id=AVATAR_C,
                org_id="org-c",
                integration_id="li-c",
                token=b"pos_token_c",
            ),
        }
        repository.get_connection.side_effect = lambda avatar_id: connections[avatar_id]

        posts_by_token = {
            "pos_token_a": [_raw_post(post_id="pa", content="A post", integration_id="li-a")],
            "pos_token_b": [_raw_post(post_id="pb", content="B post", integration_id="li-b")],
            "pos_token_c": [_raw_post(post_id="pc", content="C post", integration_id="li-c")],
        }

        def list_posts(token: str, *, start_date: str, end_date: str) -> list[dict[str, Any]]:
            return posts_by_token[token]

        client.list_posts.side_effect = list_posts
        service = _posts_service(settings=settings, client=client, repository=repository)

        start = "2026-09-01T00:00:00.000Z"
        end = "2026-09-30T23:59:59.000Z"
        a_posts = service.list_posts(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            start_date=start,
            end_date=end,
        )
        b_posts = service.list_posts(
            contos_user_id=USER_A,
            avatar_id=AVATAR_B,
            start_date=start,
            end_date=end,
        )
        c_posts = service.list_posts(
            contos_user_id=USER_A,
            avatar_id=AVATAR_C,
            start_date=start,
            end_date=end,
        )
        assert [p.id for p in a_posts] == ["pa"]
        assert [p.id for p in b_posts] == ["pb"]
        assert [p.id for p in c_posts] == ["pc"]
        assert a_posts[0].content == "A post"
        assert b_posts[0].content == "B post"
        assert c_posts[0].content == "C post"

    def test_different_user_cannot_use_other_users_connection(self) -> None:
        settings = _settings()
        repository = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            user_id=USER_A,
            avatar_id=AVATAR_A,
            integration_id="li-a",
        )
        service = _posts_service(settings=settings, repository=repository)
        from app.errors import RepositoryError

        with pytest.raises(RepositoryError, match="different ContOS user"):
            service.list_posts(
                contos_user_id=USER_B,
                avatar_id=AVATAR_A,
                start_date="2026-09-01T00:00:00.000Z",
                end_date="2026-09-30T23:59:59.000Z",
            )

    def test_non_connected_avatar_raises(self) -> None:
        settings = _settings()
        repository = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            avatar_id=AVATAR_A,
            integration_id=None,
        )
        service = _posts_service(settings=settings, repository=repository)
        with pytest.raises(PostizNotConnectedError):
            service.list_posts(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                start_date="2026-09-01T00:00:00.000Z",
                end_date="2026-09-30T23:59:59.000Z",
            )

    def test_missing_connection_raises_not_connected(self) -> None:
        repository = MagicMock()
        repository.get_connection.return_value = None
        service = _posts_service(repository=repository)
        with pytest.raises(PostizNotConnectedError, match="No Postiz connection"):
            service.create_or_update_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="draft",
                content="Hello",
                publish_date="2026-09-23T15:30:00+05:30",
            )

    def test_create_uses_avatar_integration_and_passes_timezone_unchanged(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            avatar_id=AVATAR_A,
            integration_id="li-a",
            token=b"pos_token_a",
        )
        client.create_post.return_value = [{"postId": "new-1", "integration": "li-a"}]
        service = _posts_service(settings=settings, client=client, repository=repository)

        publish_date = "2026-09-23T15:30:00+05:30"
        service.create_or_update_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="schedule",
            content="Scheduled copy",
            publish_date=publish_date,
        )

        token, payload = client.create_post.call_args.args
        assert token == "pos_token_a"
        assert payload["type"] == "schedule"
        assert payload["date"] == publish_date
        assert payload["posts"][0]["integration"]["id"] == "li-a"
        assert payload["posts"][0]["value"][0]["content"] == "Scheduled copy"
        assert payload["posts"][0]["value"][0]["image"] == []

    def test_cross_avatar_update_and_delete_rejected(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            avatar_id=AVATAR_A,
            integration_id="li-a",
            token=b"pos_token_a",
        )
        # Avatar A org only sees its own posts — B's post id is absent.
        client.list_posts.return_value = [
            _raw_post(post_id="pa", content="A", integration_id="li-a"),
        ]
        service = _posts_service(settings=settings, client=client, repository=repository)

        with pytest.raises(PostizPostNotFoundError):
            service.create_or_update_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="update",
                content="Hijack",
                publish_date="2026-09-23T15:30:00Z",
                post_id="pb-from-avatar-b",
            )
        client.create_post.assert_not_called()

        with pytest.raises(PostizPostNotFoundError):
            service.delete_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_id="pb-from-avatar-b",
            )
        client.delete_post.assert_not_called()

    def test_disconnect_b_keeps_a_and_c(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()

        conn_a = _connection(
            settings=settings,
            avatar_id=AVATAR_A,
            integration_id="li-a",
            org_id="org-a",
            token=b"pos_token_a",
        )
        conn_b = _connection(
            settings=settings,
            avatar_id=AVATAR_B,
            integration_id="li-b",
            org_id="org-b",
            token=b"pos_token_b",
        )
        conn_c = _connection(
            settings=settings,
            avatar_id=AVATAR_C,
            integration_id="li-c",
            org_id="org-c",
            token=b"pos_token_c",
        )
        connections = {AVATAR_A: conn_a, AVATAR_B: conn_b, AVATAR_C: conn_c}
        repository.get_connection.side_effect = lambda avatar_id: connections[avatar_id]

        def clear_integration(avatar_id: UUID) -> dict[str, Any]:
            assert avatar_id == AVATAR_B
            updated = {**conn_b, "postiz_integration_id": None}
            connections[AVATAR_B] = updated
            return updated

        repository.clear_integration_id.side_effect = clear_integration
        service = _posts_service(settings=settings, client=client, repository=repository)

        result = service.disconnect_linkedin(
            contos_user_id=USER_A,
            avatar_id=AVATAR_B,
        )
        assert result.disconnected is True
        assert "scheduled" in result.warning.lower()
        assert "does not log you out of LinkedIn globally" in result.warning
        client.delete_integration.assert_called_once_with("pos_token_b", "li-b")
        repository.clear_integration_id.assert_called_once_with(AVATAR_B)
        assert connections[AVATAR_A]["postiz_integration_id"] == "li-a"
        assert connections[AVATAR_C]["postiz_integration_id"] == "li-c"
        assert connections[AVATAR_B]["postiz_integration_id"] is None
        assert connections[AVATAR_B]["postiz_organization_id"] == "org-b"
        assert connections[AVATAR_B]["encrypted_access_token"]

    def test_calendar_switch_abc_does_not_return_stale_events(self) -> None:
        """Simulates Calendar remount A→B→C: each list uses only that avatar token."""
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        connections = {
            AVATAR_A: _connection(
                settings=settings,
                avatar_id=AVATAR_A,
                integration_id="li-a",
                token=b"pos_a",
            ),
            AVATAR_B: _connection(
                settings=settings,
                avatar_id=AVATAR_B,
                integration_id="li-b",
                token=b"pos_b",
            ),
            AVATAR_C: _connection(
                settings=settings,
                avatar_id=AVATAR_C,
                integration_id="li-c",
                token=b"pos_c",
            ),
        }
        repository.get_connection.side_effect = lambda avatar_id: connections[avatar_id]
        client.list_posts.side_effect = lambda token, **_: [
            _raw_post(
                post_id=f"post-{token}",
                content=token,
                integration_id=f"li-{token[-1]}",
            ),
        ]
        service = _posts_service(settings=settings, client=client, repository=repository)
        start = "2026-09-01T00:00:00.000Z"
        end = "2026-09-30T23:59:59.000Z"

        seen: list[str] = []
        for avatar in (AVATAR_A, AVATAR_B, AVATAR_C):
            posts = service.list_posts(
                contos_user_id=USER_A,
                avatar_id=avatar,
                start_date=start,
                end_date=end,
            )
            assert len(posts) == 1
            seen.append(posts[0].id)

        assert seen == ["post-pos_a", "post-pos_b", "post-pos_c"]
        assert client.list_posts.call_count == 3

    def test_unowned_avatar_route_returns_404(self) -> None:
        from app.api.deps import get_current_user_id
        from app.errors import RepositoryError
        from app.main import app

        app.dependency_overrides[get_current_user_id] = lambda: USER_A
        try:
            with patch("app.api.routes.postiz.SupabaseRepository") as repo_cls:
                repo_cls.return_value.verify_avatar_owner.side_effect = RepositoryError(
                    "Avatar not found or you do not have permission to access it.",
                )
                client = TestClient(app)
                response = client.get(
                    f"/api/postiz/posts?avatar_id={AVATAR_B}"
                    "&start_date=2026-09-01T00:00:00.000Z"
                    "&end_date=2026-09-30T23:59:59.000Z",
                )
                assert response.status_code == 404
                response = client.delete(
                    f"/api/postiz/integration?avatar_id={AVATAR_B}",
                )
                assert response.status_code == 404
        finally:
            app.dependency_overrides.clear()

    def test_posts_routes_require_auth(self) -> None:
        from app.main import app

        client = TestClient(app)
        assert (
            client.get(
                f"/api/postiz/posts?avatar_id={AVATAR_A}"
                "&start_date=2026-09-01T00:00:00.000Z"
                "&end_date=2026-09-30T23:59:59.000Z",
            ).status_code
            == 401
        )
        assert client.post("/api/postiz/posts", json={}).status_code == 401
        assert (
            client.delete(f"/api/postiz/posts/x?avatar_id={AVATAR_A}").status_code == 401
        )
        assert (
            client.delete(f"/api/postiz/integration?avatar_id={AVATAR_A}").status_code
            == 401
        )
