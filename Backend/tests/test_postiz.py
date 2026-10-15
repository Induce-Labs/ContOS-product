"""Postiz LinkedIn bridge tests (avatar-scoped Approach B)."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.clients.postiz_client import (
    PostizClient,
    is_provision_rotate_required_conflict,
    strip_unsupported_linkedin_prompt,
    _sanitize_upstream_body_preview,
)
from app.config import Settings
from app.errors import (
    PostizAuthorizationInvalidError,
    PostizBadRequestError,
    PostizIntegrationClaimError,
    PostizNotConnectedError,
    PostizPostNotFoundError,
    PostizServiceError,
    RepositoryError,
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
MIGRATION_X_INTEGRATION_ID = (
    REPO_ROOT / "supabase" / "migrations" / "20260925000000_postiz_x_integration_id.sql"
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
    x_integration_id: str | None = None,
) -> dict[str, Any]:
    fernet = Fernet(settings.postiz_token_encryption_key.encode())
    return {
        "contos_user_id": str(user_id),
        "avatar_id": str(avatar_id),
        "encrypted_access_token": fernet.encrypt(token).decode(),
        "postiz_organization_id": org_id,
        "postiz_integration_id": integration_id,
        "postiz_x_integration_id": x_integration_id,
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


class TestPostizUploadErrorSanitization:
    def test_html_504_body_is_sanitized(self) -> None:
        preview = _sanitize_upstream_body_preview(
            "<html><head><title>504 Gateway Time-out</title></head>"
            "<body><center><h1>504 Gateway Time-out</h1></center>"
            "<hr><center>nginx/1.22.1</center></body></html>",
            status_code=504,
        )
        assert "504" in preview
        assert "<html" not in preview.lower()
        assert "STORAGE_PROVIDER" in preview

    def test_json_error_body_is_kept(self) -> None:
        preview = _sanitize_upstream_body_preview(
            '{"msg":"Unsupported file type."}',
            status_code=400,
        )
        assert preview == '{"msg":"Unsupported file type."}'

    def test_error_preview_redacts_secrets_before_return(self) -> None:
        preview = _sanitize_upstream_body_preview(
            "Unsupported file type. Authorization: Bearer eyJhbGciOi.sig "
            "token pos_live_example client_secret=oauth-secret "
            "redis://user:pass@redis:6379/0 "
            '{"access_token":"pos_json_example","oauth_token_secret":"x-secret"}',
            status_code=400,
        )
        assert "Unsupported file type." in preview
        assert "pos_" not in preview
        assert "Bearer eyJ" not in preview
        assert "oauth-secret" not in preview
        assert "x-secret" not in preview
        assert "user:pass@" not in preview
        assert "redis://" not in preview

    def test_upload_log_extra_must_not_use_reserved_filename_key(self) -> None:
        """Logging extra key `filename` crashes LogRecord and becomes ContOS 500."""
        import logging

        log = logging.getLogger("contos.test.upload_log_keys")
        log.handlers.clear()
        log.setLevel(logging.INFO)
        log.propagate = False
        log.addHandler(logging.NullHandler())
        with pytest.raises(KeyError, match="filename"):
            log.info("boom", extra={"filename": "photo.jpg"})
        # Safe key used by Postiz upload diagnostics.
        log.info(
            "ok",
            extra={
                "upload_filename": "photo.jpg",
                "content_type": "image/jpeg",
                "size_bytes": 12,
                "elapsed_ms": 1,
                "status_code": 504,
            },
        )

    def test_upload_media_log_does_not_raise_before_postiz_call(self) -> None:
        """Regression: ContOS 500 was KeyError on LogRecord before Postiz was called."""
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            avatar_id=AVATAR_A,
            integration_id="li-a",
            token=b"pos_token_a",
        )
        client.upload_file.side_effect = PostizServiceError(
            "Postiz upload failed with status 504: gateway timeout",
            status_code=504,
        )
        service = _posts_service(settings=settings, client=client, repository=repository)
        with pytest.raises(PostizServiceError) as raised:
            service.upload_media(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                filename="diagram.png",
                content=b"\x89PNG\r\n\x1a\nfake",
                content_type="image/png",
            )
        assert raised.value.status_code == 504
        client.upload_file.assert_called_once()
        assert not is_provision_rotate_required_conflict(400, {"msg": "no valid access token"})

    def test_client_accepts_postiz_201_created_upload_body(self) -> None:
        """Live Postiz returns HTTP 201 + camelCase originalName; ContOS must not treat as error."""
        settings = _settings()
        client = PostizClient(settings)
        media_id = "38ffdbc4-865a-4e9c-8452-e7957bbb072d"
        path = "https://postiz.contos.now/uploads/2026/09/23/example.png"

        class FakeResponse:
            status_code = 201
            text = json.dumps(
                {
                    "id": media_id,
                    "name": "example.png",
                    "originalName": None,
                    "path": path,
                    "thumbnail": None,
                    "alt": None,
                },
            )
            headers = {"content-type": "application/json; charset=utf-8"}

            def json(self) -> dict[str, Any]:
                return json.loads(self.text)

        with patch("app.clients.postiz_client.httpx.Client") as client_cls:
            instance = client_cls.return_value.__enter__.return_value
            instance.post.return_value = FakeResponse()
            data = client.upload_file(
                "pos_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                filename="example.png",
                content=b"\x89PNG\r\n\x1a\nfake",
                content_type="image/png",
            )

        assert data["id"] == media_id
        assert data["path"] == path
        assert data["originalName"] is None
        instance.post.assert_called_once()

    def test_upload_media_maps_postiz_201_shape_to_media_ref(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            avatar_id=AVATAR_A,
            integration_id="li-a",
            token=b"pos_token_a",
        )
        client.upload_file.return_value = {
            "id": "a1a17a6b-141b-47d1-af7f-8a9c4a2ef4f1",
            "name": "a7191da6ff5a336d9fbd0e91a5e1da9f.png",
            "originalName": None,
            "path": "https://postiz.contos.now/uploads/2026/09/23/a7191.png",
            "thumbnail": None,
            "alt": None,
        }
        service = _posts_service(settings=settings, client=client, repository=repository)
        media = service.upload_media(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            filename="photo.png",
            content=b"\x89PNG\r\n\x1a\nfake",
            content_type="image/png",
        )
        assert media.id == "a1a17a6b-141b-47d1-af7f-8a9c4a2ef4f1"
        assert media.path.endswith("/a7191.png")
        assert media.name == "a7191da6ff5a336d9fbd0e91a5e1da9f.png"
        assert media.original_name is None

    def test_parse_media_ref_accepts_snake_case_original_name(self) -> None:
        media = PostizPostsService._parse_media_ref(
            {
                "id": "m1",
                "path": "https://cdn.example.com/m1.jpg",
                "original_name": "holiday.jpg",
            },
            require_name=False,
        )
        assert media is not None
        assert media.original_name == "holiday.jpg"

    def test_contos_upload_route_returns_200_snake_case_not_201(self) -> None:
        """Frontend must receive ContOS 200 + snake_case even when Postiz used 201."""
        from app.api.deps import get_current_user_id
        from app.main import app
        from app.services.postiz_posts import MediaRef

        media = MediaRef(
            id="38ffdbc4-865a-4e9c-8452-e7957bbb072d",
            path="https://postiz.contos.now/uploads/2026/09/23/example.png",
            name="example.png",
            original_name=None,
            alt=None,
            thumbnail=None,
        )
        app.dependency_overrides[get_current_user_id] = lambda: USER_A
        try:
            with (
                patch("app.api.routes.postiz.SupabaseRepository") as repo_cls,
                patch("app.api.routes.postiz._get_posts_service") as posts_factory,
            ):
                repo_cls.return_value.verify_avatar_owner.return_value = None
                posts_factory.return_value.upload_media.return_value = media
                client = TestClient(app)
                response = client.post(
                    f"/api/postiz/upload?avatar_id={AVATAR_A}",
                    files={"file": ("example.png", b"\x89PNG\r\n\x1a\nfake", "image/png")},
                )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        body = response.json()
        assert body == {
            "id": media.id,
            "path": media.path,
            "alt": None,
            "thumbnail": None,
            "name": "example.png",
            "original_name": None,
        }
        assert "originalName" not in body


class TestPostizProvisionSecretNormalization:
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
    def test_create_post_uses_the_publish_read_timeout(self) -> None:
        client = PostizClient(_settings())
        response = MagicMock()
        response.status_code = 200
        response.text = '{"ok": true}'
        response.json.return_value = {"ok": True}
        with patch("app.clients.postiz_client.httpx.Client") as client_cls:
            instance = client_cls.return_value.__enter__.return_value
            instance.request.return_value = response
            client.create_post("pos_" + ("a" * 32), {"type": "draft", "posts": []})
        timeout = client_cls.call_args.kwargs["timeout"]
        assert timeout.read == 120.0
        assert client._timeout.read == 30.0

    def test_rejects_disallowed_navigation_origin(self) -> None:
        client = PostizClient(_settings())
        with pytest.raises(PostizServiceError):
            client.validate_navigation_url("https://evil.example/phish")

    def test_strip_unsupported_linkedin_prompt_none(self) -> None:
        raw = (
            "https://www.linkedin.com/oauth/v2/authorization?response_type=code"
            "&client_id=abc&prompt=none&redirect_uri=https%3A%2F%2Fpostiz.example"
            "%2Fintegrations%2Fsocial%2Flinkedin&state=xyz"
            "&scope=openid%20profile%20w_member_social"
        )
        cleaned = strip_unsupported_linkedin_prompt(raw)
        assert "prompt=" not in cleaned
        assert "prompt=none" not in cleaned
        assert "scope=openid%20profile%20w_member_social" in cleaned
        assert "state=xyz" in cleaned
        assert "response_type=code" in cleaned

    def test_get_linkedin_authorization_url_strips_prompt_none(self) -> None:
        settings = _settings()
        client = PostizClient(settings)
        dirty = (
            "https://www.linkedin.com/oauth/v2/authorization?response_type=code"
            "&client_id=abc&prompt=none&redirect_uri="
            "https%3A%2F%2Fpostiz.contos.now%2Fintegrations%2Fsocial%2Flinkedin"
            "&state=s1&scope=openid%20profile%20w_member_social"
        )
        with patch.object(client, "_request_json", return_value={"url": dirty}):
            url = client.get_linkedin_authorization_url(
                "pos_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            )
        assert "prompt=" not in url
        assert "openid%20profile%20w_member_social" in url

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

    def test_status_does_not_offer_other_linkedin_accounts_when_stored_id_is_missing(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            integration_id="li-gone",
            x_integration_id="x-kept",
        )
        repository.get_connection_by_integration_id.return_value = None
        client.list_integrations.return_value = [
            {
                "id": "x-kept",
                "name": "contos",
                "identifier": "x",
                "disabled": False,
            },
            {
                "id": "li-live-1",
                "name": "First",
                "identifier": "linkedin",
                "disabled": False,
            },
            {
                "id": "li-live-2",
                "name": "Second",
                "identifier": "linkedin",
                "disabled": False,
            },
        ]
        service = _service(settings=settings, client=client, repository=repository)
        status = service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_A)
        repository.clear_integration_id.assert_not_called()
        repository.claim_integration.assert_not_called()
        assert status.connected is False
        assert status.claim_candidates == ()

    def test_status_keeps_stored_linkedin_id_when_postiz_returns_empty(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            integration_id="li-sheema",
        )
        client.list_integrations.return_value = []
        service = _service(settings=settings, client=client, repository=repository)
        status = service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_A)
        repository.clear_integration_id.assert_not_called()
        assert status.connected is False
        assert status.claim_candidates == ()

    def test_status_does_not_claim_a_preexisting_linkedin_when_stored_id_is_missing(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            integration_id="li-gone",
        )
        repository.get_connection_by_integration_id.return_value = None
        client.list_integrations.return_value = [
            {
                "id": "li-live",
                "name": "Only",
                "identifier": "linkedin",
                "disabled": False,
            },
        ]
        service = _service(settings=settings, client=client, repository=repository)
        status = service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_A)
        repository.clear_integration_id.assert_not_called()
        repository.claim_integration.assert_not_called()
        assert status.connected is False
        assert status.claim_candidates == ()

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
        assert status.connected is False
        assert status.claim_candidates == ()
        repository.claim_integration.assert_not_called()

    def test_manual_claim_is_rejected(self) -> None:
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
        with pytest.raises(PostizIntegrationClaimError, match="cannot select"):
            service.claim_linkedin_integration(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                integration_id="li-1",
            )
        repository.claim_integration.assert_not_called()

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

    def test_status_upstream_502_without_cache_propagates(self) -> None:
        """ContOS maps Postiz gateway 502 → PostizServiceError (route → HTTP 502)."""
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            token=b"pos_ok",
            integration_id="li-1",
        )
        client.list_integrations.side_effect = PostizServiceError(
            "Postiz request failed with status 502: ",
            status_code=502,
        )
        service = _service(settings=settings, client=client, repository=repository)
        with pytest.raises(PostizServiceError) as raised:
            service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_A)
        assert raised.value.status_code == 502
        repository.delete_connection.assert_not_called()

    def test_status_upstream_502_returns_cached_status(self) -> None:
        settings = _settings()
        repository = MagicMock()
        client = MagicMock()
        redis = FakeRedis()
        repository.get_connection.return_value = _connection(
            settings=settings,
            token=b"pos_ok",
            integration_id="li-1",
        )
        client.list_integrations.side_effect = PostizServiceError(
            "Postiz request failed with status 502: Bad Gateway",
            status_code=502,
        )
        service = _service(
            settings=settings,
            client=client,
            repository=repository,
            redis_client=redis,
        )
        service._set_status_cache(
            AVATAR_A,
            PostizStatus(
                connected=True,
                integration=SafeIntegration(
                    id="li-1",
                    name="LinkedIn",
                    identifier="linkedin",
                    picture=None,
                ),
            ),
        )
        status = service.get_status(contos_user_id=USER_A, avatar_id=AVATAR_A)
        assert status.connected is True
        assert status.integration is not None
        assert status.integration.id == "li-1"
        repository.delete_connection.assert_not_called()

    def test_list_integrations_uses_raw_pos_authorization_header(self) -> None:
        """Public API auth is Authorization: pos_… (not Bearer)."""
        settings = _settings()
        client = PostizClient(settings)
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "[]"
        mock_response.content = b"[]"
        mock_response.headers = {"content-type": "application/json"}
        mock_response.json.return_value = []

        with patch("app.clients.postiz_client.httpx.Client") as client_cls:
            http = MagicMock()
            client_cls.return_value.__enter__.return_value = http
            http.request.return_value = mock_response
            result = client.list_integrations("pos_test_token_abc")

        assert result == []
        args, kwargs = http.request.call_args
        assert args[0] == "GET"
        assert args[1] == f"{settings.postiz_public_api_base_url}/integrations"
        assert kwargs["headers"]["Authorization"] == "pos_test_token_abc"
        assert not kwargs["headers"]["Authorization"].startswith("Bearer ")

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

    def test_x_integration_id_migration_is_separate_from_linkedin(self) -> None:
        sql = MIGRATION_X_INTEGRATION_ID.read_text(encoding="utf-8")
        assert "postiz_x_integration_id" in sql
        assert "postiz_connections_postiz_x_integration_id_unique" in sql
        assert "WHERE postiz_x_integration_id IS NOT NULL" in sql
        assert "DROP COLUMN" not in sql.upper()
        assert "postiz_integration_id text" not in sql

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

    def test_personal_linkedin_auth_url_has_no_prompt_none(self) -> None:
        """Regression: reconnect must not silently reuse LinkedIn via prompt=none."""
        provider = (
            REPO_ROOT
            / "_postiz-v2.23.0"
            / "libraries"
            / "nestjs-libraries"
            / "src"
            / "integrations"
            / "social"
            / "linkedin.provider.ts"
        )
        source = provider.read_text(encoding="utf-8")
        assert "prompt=none" not in source
        assert "&prompt=" not in source
        assert "scopes = ['openid', 'profile', 'w_member_social']" in source
        assert "oauth/v2/authorization?response_type=code&client_id=" in source
        assert "state=${state}" in source
        assert "redirect_uri=" in source


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
        assert (
            client.post(f"/api/postiz/upload?avatar_id={AVATAR_A}").status_code == 401
        )


class TestPostizMediaPosts:
    """LinkedIn multi-image (max 10) and single MP4 video via value[].image."""

    def _connected(
        self,
        *,
        settings: Settings,
        client: MagicMock,
        repository: MagicMock,
        avatar_id: UUID = AVATAR_A,
        user_id: UUID = USER_A,
        integration_id: str = "li-a",
        token: bytes = b"pos_token_a",
    ) -> PostizPostsService:
        repository.get_connection.return_value = _connection(
            settings=settings,
            avatar_id=avatar_id,
            user_id=user_id,
            integration_id=integration_id,
            token=token,
        )
        return _posts_service(settings=settings, client=client, repository=repository)

    def test_single_and_multiple_ordered_images(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        client.create_post.return_value = [{"postId": "p1"}]
        client.get_media.side_effect = lambda _token, media_id: {
            "id": media_id,
            "path": f"https://cdn.example.com/{media_id}.jpg",
        }

        from app.services.postiz_posts import MediaRef

        service.create_or_update_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="now",
            content="One image",
            publish_date="2026-09-23T15:30:00+05:30",
            images=[
                MediaRef(id="m1", path="https://cdn.example.com/m1.jpg"),
            ],
        )
        payload = client.create_post.call_args.args[1]
        assert payload["posts"][0]["value"][0]["image"] == [
            {"id": "m1", "path": "https://cdn.example.com/m1.jpg"},
        ]
        assert payload["posts"][0]["settings"] == {"__type": "linkedin"}
        assert "post_as_images_carousel" not in payload["posts"][0]["settings"]

        client.create_post.reset_mock()
        service.create_or_update_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="schedule",
            content="Multi",
            publish_date="2026-09-23T15:30:00+05:30",
            images=[
                MediaRef(id="m1", path="https://cdn.example.com/m1.jpg"),
                MediaRef(id="m2", path="https://cdn.example.com/m2.jpg"),
                MediaRef(id="m3", path="https://cdn.example.com/m3.jpg"),
            ],
        )
        images = client.create_post.call_args.args[1]["posts"][0]["value"][0]["image"]
        assert [item["id"] for item in images] == ["m1", "m2", "m3"]

    def test_draft_with_images(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        client.create_post.return_value = [{"postId": "d1"}]
        client.get_media.side_effect = lambda _token, media_id: {
            "id": media_id,
            "path": f"https://cdn.example.com/{media_id}.png",
        }
        from app.services.postiz_posts import MediaRef

        service.create_or_update_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="draft",
            content="Draft media",
            publish_date="2026-09-23T15:30:00+05:30",
            images=[MediaRef(id="m9", path="https://cdn.example.com/m9.png")],
        )
        assert client.create_post.call_args.args[1]["type"] == "draft"
        assert len(client.create_post.call_args.args[1]["posts"][0]["value"][0]["image"]) == 1

    def test_edit_add_remove_reorder_and_remove_all(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        client.list_posts.return_value = [
            _raw_post(post_id="pa", content="A", integration_id="li-a"),
        ]
        client.create_post.return_value = [{"postId": "pa"}]
        client.get_media.side_effect = lambda _token, media_id: {
            "id": media_id,
            "path": f"https://cdn.example.com/{media_id}.jpg",
        }
        from app.services.postiz_posts import MediaRef

        # Existing A,B,C → remove B + add D = A,C,D
        service.create_or_update_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="update",
            content="Updated",
            publish_date="2026-09-23T15:30:00Z",
            post_id="pa",
            images=[
                MediaRef(id="A", path="https://cdn.example.com/A.jpg"),
                MediaRef(id="C", path="https://cdn.example.com/C.jpg"),
                MediaRef(id="D", path="https://cdn.example.com/D.jpg"),
            ],
        )
        images = client.create_post.call_args.args[1]["posts"][0]["value"][0]["image"]
        assert [item["id"] for item in images] == ["A", "C", "D"]
        assert client.create_post.call_args.args[1]["posts"][0]["value"][0]["id"] == "pa"

        # Remove all → images: []
        client.create_post.reset_mock()
        client.get_media.reset_mock()
        service.create_or_update_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="update",
            content="No media",
            publish_date="2026-09-23T15:30:00Z",
            post_id="pa",
            images=[],
        )
        assert client.create_post.call_args.args[1]["posts"][0]["value"][0]["image"] == []
        client.get_media.assert_not_called()

    def test_cross_avatar_media_rejected(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        client.get_media.side_effect = PostizServiceError(
            "Postiz request failed with status 404: Media not found",
        )
        from app.errors import PostizMediaOwnershipError
        from app.services.postiz_posts import MediaRef

        with pytest.raises(PostizMediaOwnershipError):
            service.create_or_update_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="Steal",
                publish_date="2026-09-23T15:30:00Z",
                images=[
                    MediaRef(id="foreign", path="https://cdn.example.com/foreign.jpg"),
                ],
            )
        client.create_post.assert_not_called()

    def test_path_mismatch_rejected(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        client.get_media.return_value = {
            "id": "m1",
            "path": "https://cdn.example.com/real.jpg",
        }
        from app.errors import PostizMediaOwnershipError
        from app.services.postiz_posts import MediaRef

        with pytest.raises(PostizMediaOwnershipError):
            service.create_or_update_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="Mismatch",
                publish_date="2026-09-23T15:30:00Z",
                images=[
                    MediaRef(id="m1", path="https://cdn.example.com/fake.jpg"),
                ],
            )
        client.create_post.assert_not_called()

    def test_accepts_exactly_ten_images(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        client.create_post.return_value = [{"postId": "p10"}]
        client.get_media.side_effect = lambda _token, media_id: {
            "id": media_id,
            "path": f"https://cdn.example.com/{media_id}.jpg",
        }
        from app.services.postiz_posts import MediaRef

        ten = [
            MediaRef(id=f"m{i}", path=f"https://cdn.example.com/m{i}.jpg")
            for i in range(10)
        ]
        service.create_or_update_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="now",
            content="Exactly ten",
            publish_date="2026-09-23T15:30:00Z",
            images=ten,
        )
        images = client.create_post.call_args.args[1]["posts"][0]["value"][0]["image"]
        assert [item["id"] for item in images] == [f"m{i}" for i in range(10)]

    def test_rejects_more_than_ten_images(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        from app.errors import PostizBadRequestError
        from app.services.postiz_posts import MediaRef

        too_many = [
            MediaRef(id=f"m{i}", path=f"https://cdn.example.com/m{i}.jpg")
            for i in range(11)
        ]
        with pytest.raises(PostizBadRequestError, match="at most 10"):
            service.create_or_update_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="Too many",
                publish_date="2026-09-23T15:30:00Z",
                images=too_many,
            )
        client.create_post.assert_not_called()

    def test_upload_failure_does_not_create_post(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        client.upload_file.side_effect = PostizServiceError(
            "Postiz upload failed with status 400: Unsupported file type.",
        )
        with pytest.raises(PostizServiceError, match="400"):
            service.upload_media(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                filename="bad.bin",
                content=b"not-an-image",
                content_type="image/jpeg",
            )
        client.create_post.assert_not_called()

    def test_upload_accepts_mp4_video(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        client.upload_file.return_value = {
            "id": "vid-1",
            "name": "clip.mp4",
            "path": "https://cdn.example.com/uploads/clip.mp4",
            "originalName": "clip.mp4",
            "thumbnail": None,
            "alt": None,
        }
        media = service.upload_media(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            filename="clip.mp4",
            content=b"\x00\x00\x00\x18ftypmp42fake",
            content_type="video/mp4",
        )
        assert media.id == "vid-1"
        assert media.path.endswith(".mp4")
        client.upload_file.assert_called_once()
        assert client.upload_file.call_args.kwargs["content_type"] == "video/mp4"
        assert client.upload_file.call_args.kwargs["filename"] == "clip.mp4"

    def test_upload_accepts_jpeg_and_png(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        client.upload_file.side_effect = [
            {
                "id": "jpg-1",
                "path": "https://cdn.example.com/a.jpg",
                "name": "a.jpg",
            },
            {
                "id": "png-1",
                "path": "https://cdn.example.com/b.png",
                "name": "b.png",
            },
        ]
        jpeg = service.upload_media(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            filename="a.jpg",
            content=b"\xff\xd8\xfffake",
            content_type="image/jpeg",
        )
        png = service.upload_media(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            filename="b.png",
            content=b"\x89PNG\r\n\x1a\nfake",
            content_type="image/png",
        )
        assert jpeg.path.endswith(".jpg")
        assert png.path.endswith(".png")
        assert client.upload_file.call_count == 2

    def test_validate_upload_size_rejects_oversized_without_allocating(self) -> None:
        from app.errors import PostizBadRequestError
        from app.services import postiz_posts as posts_mod

        with pytest.raises(PostizBadRequestError, match="Image exceeds"):
            posts_mod._validate_upload_size(
                "image/jpeg",
                posts_mod._MAX_IMAGE_BYTES + 1,
            )
        with pytest.raises(PostizBadRequestError, match="Video exceeds"):
            posts_mod._validate_upload_size(
                "video/mp4",
                posts_mod._MAX_VIDEO_BYTES + 1,
            )
        posts_mod._validate_upload_size("image/png", posts_mod._MAX_IMAGE_BYTES)
        posts_mod._validate_upload_size("video/mp4", posts_mod._MAX_VIDEO_BYTES)

    def test_upload_rejects_unsupported_video_mimes(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        from app.errors import PostizBadRequestError

        for mime, name in (
            ("video/webm", "clip.webm"),
            ("video/quicktime", "clip.mov"),
            ("video/x-msvideo", "clip.avi"),
            ("video/x-matroska", "clip.mkv"),
        ):
            with pytest.raises(PostizBadRequestError, match="Unsupported upload type"):
                service.upload_media(
                    contos_user_id=USER_A,
                    avatar_id=AVATAR_A,
                    filename=name,
                    content=b"fake",
                    content_type=mime,
                )
        client.upload_file.assert_not_called()

    def test_upload_rejects_mime_extension_mismatch(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        from app.errors import PostizBadRequestError

        with pytest.raises(PostizBadRequestError, match="cannot use a .mp4 filename"):
            service.upload_media(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                filename="fake.mp4",
                content=b"\xff\xd8\xfffake",
                content_type="image/jpeg",
            )
        with pytest.raises(PostizBadRequestError, match="require a .mp4 filename"):
            service.upload_media(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                filename="clip.jpg",
                content=b"fake-video",
                content_type="video/mp4",
            )
        client.upload_file.assert_not_called()

    def test_single_video_post_uses_image_array(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        client.create_post.return_value = [{"postId": "pv1"}]
        client.get_media.return_value = {
            "id": "v1",
            "path": "https://cdn.example.com/clip.mp4",
        }
        from app.services.postiz_posts import MediaRef

        service.create_or_update_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="now",
            content="One video",
            publish_date="2026-09-23T15:30:00Z",
            images=[
                MediaRef(id="v1", path="https://cdn.example.com/clip.mp4"),
            ],
        )
        payload = client.create_post.call_args.args[1]
        image_field = payload["posts"][0]["value"][0]["image"]
        assert image_field == [
            {"id": "v1", "path": "https://cdn.example.com/clip.mp4"},
        ]
        assert image_field[0]["path"].endswith(".mp4")

    def test_rejects_two_videos_and_image_video_mix(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        from app.errors import PostizBadRequestError
        from app.services.postiz_posts import MediaRef

        with pytest.raises(PostizBadRequestError, match="at most one video"):
            service.create_or_update_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="Two videos",
                publish_date="2026-09-23T15:30:00Z",
                images=[
                    MediaRef(id="v1", path="https://cdn.example.com/a.mp4"),
                    MediaRef(id="v2", path="https://cdn.example.com/b.mp4"),
                ],
            )
        with pytest.raises(PostizBadRequestError, match="cannot combine video and image"):
            service.create_or_update_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="Image then video",
                publish_date="2026-09-23T15:30:00Z",
                images=[
                    MediaRef(id="m1", path="https://cdn.example.com/a.jpg"),
                    MediaRef(id="v1", path="https://cdn.example.com/a.mp4"),
                ],
            )
        with pytest.raises(PostizBadRequestError, match="cannot combine video and image"):
            service.create_or_update_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="Video then image",
                publish_date="2026-09-23T15:30:00Z",
                images=[
                    MediaRef(id="v1", path="https://cdn.example.com/a.mp4"),
                    MediaRef(id="m1", path="https://cdn.example.com/a.jpg"),
                ],
            )
        client.create_post.assert_not_called()

    def test_text_only_still_sends_empty_image_array(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        client.create_post.return_value = [{"postId": "t1"}]
        service.create_or_update_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="now",
            content="Text only",
            publish_date="2026-09-23T15:30:00Z",
        )
        assert client.create_post.call_args.args[1]["posts"][0]["value"][0]["image"] == []
        client.get_media.assert_not_called()

    def test_list_maps_images_for_edit_hydration(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        service = self._connected(settings=settings, client=client, repository=repository)
        raw = _raw_post(post_id="pa", content="With media", integration_id="li-a")
        raw["image"] = json.dumps(
            [
                {"id": "m1", "path": "https://cdn.example.com/m1.jpg"},
                {"id": "m2", "path": "https://cdn.example.com/m2.jpg"},
            ],
        )
        client.list_posts.return_value = [raw]
        posts = service.list_posts(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            start_date="2026-09-01T00:00:00.000Z",
            end_date="2026-09-30T23:59:59.000Z",
        )
        assert len(posts) == 1
        assert [image.id for image in posts[0].images] == ["m1", "m2"]


def _x_auth_url() -> str:
    return "https://api.twitter.com/oauth/authenticate?oauth_token=request-token"


class TestPostizX:
    """X connect/claim/posts beside LinkedIn. Postiz is mocked; no live X API."""

    def _ready(
        self,
        *,
        avatar_id: UUID = AVATAR_A,
        user_id: UUID = USER_A,
        linkedin_id: str | None = "li-a",
        x_id: str | None = "x-a",
        token: bytes = b"pos_token_a",
        max_length: Any = 280,
    ) -> tuple[PostizPostsService, MagicMock, MagicMock, Settings]:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            avatar_id=avatar_id,
            user_id=user_id,
            integration_id=linkedin_id,
            x_integration_id=x_id,
            token=token,
        )
        client.get_integration_settings.return_value = {
            "output": {"maxLength": max_length},
        }
        client.create_post.return_value = [{"postId": "px"}]
        client.get_media.side_effect = lambda _token, media_id: {
            "id": media_id,
            "path": f"https://cdn.example.com/{media_id}.jpg",
        }
        service = _posts_service(settings=settings, client=client, repository=repository)
        return service, client, repository, settings

    def test_x_connect_calls_social_x_and_leaves_linkedin_id(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        redis_client = FakeRedis()
        repository.get_connection.return_value = _connection(
            settings=settings,
            integration_id="li-a",
            x_integration_id=None,
        )
        client.list_integrations.return_value = [
            {"id": "li-a", "name": "LI", "identifier": "linkedin", "disabled": False},
        ]
        client.get_x_authorization_url.return_value = _x_auth_url()
        service = _service(
            settings=settings,
            client=client,
            repository=repository,
            redis_client=redis_client,
        )
        result = service.start_x_connect(contos_user_id=USER_A, avatar_id=AVATAR_A)
        assert result.flow == "x"
        assert result.authorization_url == _x_auth_url()
        client.get_x_authorization_url.assert_called_once()
        client.get_linkedin_authorization_url.assert_not_called()
        repository.claim_integration.assert_not_called()
        repository.claim_x_integration.assert_not_called()
        assert any(key.startswith("postiz:x:snapshot:") for key in redis_client.store)
        assert not any(key.startswith("postiz:linkedin:snapshot:") for key in redis_client.store)

    def test_x_claim_stores_x_id_and_rejects_linkedin_identifier(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        redis_client = FakeRedis()
        repository.get_connection.return_value = _connection(
            settings=settings,
            integration_id="li-a",
        )
        client.list_integrations.return_value = []
        client.get_x_authorization_url.return_value = _x_auth_url()
        service = _service(
            settings=settings,
            client=client,
            repository=repository,
            redis_client=redis_client,
        )
        service.start_x_connect(contos_user_id=USER_A, avatar_id=AVATAR_A)

        client.list_integrations.return_value = [
            {"id": "li-a", "name": "LI", "identifier": "linkedin", "disabled": False},
        ]
        with pytest.raises(PostizIntegrationClaimError, match="not found"):
            service.claim_x_integration(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                integration_id="li-a",
            )
        repository.claim_x_integration.assert_not_called()
        repository.claim_integration.assert_not_called()

        client.list_integrations.return_value = [
            {"id": "x-a", "name": "XA", "identifier": "x", "disabled": False},
            {"id": "li-a", "name": "LI", "identifier": "linkedin", "disabled": False},
        ]
        repository.get_connection_by_x_integration_id.return_value = None
        repository.claim_x_integration.return_value = _connection(
            settings=settings,
            integration_id="li-a",
            x_integration_id="x-a",
        )
        status = service.claim_x_integration(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            integration_id="x-a",
        )
        assert status.connected is True
        assert status.integration is not None
        assert status.integration.identifier == "x"
        assert status.integration.id == "x-a"
        repository.claim_x_integration.assert_called_once_with(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            postiz_x_integration_id="x-a",
        )
        repository.claim_integration.assert_not_called()

    def test_x_claim_and_disconnect_are_avatar_scoped(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        redis_client = FakeRedis()
        connections = {
            AVATAR_A: _connection(
                settings=settings,
                avatar_id=AVATAR_A,
                integration_id="li-a",
                x_integration_id="x-a",
                token=b"pos_token_a",
            ),
            AVATAR_B: _connection(
                settings=settings,
                avatar_id=AVATAR_B,
                user_id=USER_A,
                org_id="org-b",
                integration_id="li-b",
                x_integration_id=None,
                token=b"pos_token_b",
            ),
        }
        repository.get_connection.side_effect = lambda avatar_id: connections[avatar_id]
        client.list_integrations.return_value = [
            {"id": "x-a", "name": "XA", "identifier": "x", "disabled": False},
        ]
        client.get_x_authorization_url.return_value = _x_auth_url()
        service = _service(
            settings=settings,
            client=client,
            repository=repository,
            redis_client=redis_client,
        )
        service.start_x_connect(contos_user_id=USER_A, avatar_id=AVATAR_B)
        repository.get_connection_by_x_integration_id.return_value = connections[AVATAR_A]
        with pytest.raises(PostizIntegrationClaimError, match="another ContOS avatar"):
            service.claim_x_integration(
                contos_user_id=USER_A,
                avatar_id=AVATAR_B,
                integration_id="x-a",
            )
        repository.claim_x_integration.assert_not_called()

        posts, posts_client, posts_repo, _posts_settings = self._ready()
        posts.disconnect_x(contos_user_id=USER_A, avatar_id=AVATAR_A)
        posts_client.delete_integration.assert_called_once()
        assert posts_client.delete_integration.call_args.args[1] == "x-a"
        posts_repo.clear_x_integration_id.assert_called_once_with(AVATAR_A)
        posts_repo.clear_integration_id.assert_not_called()

    def test_x_post_uses_x_integration_and_type(self) -> None:
        service, client, _repository, _settings_obj = self._ready()
        service.create_x_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="schedule",
            content="Hello X",
            publish_date="2026-09-23T15:30:00Z",
        )
        client.get_integration_settings.assert_called_once_with("pos_token_a", "x-a")
        payload = client.create_post.call_args.args[1]
        assert payload["type"] == "schedule"
        assert payload["posts"][0]["integration"]["id"] == "x-a"
        assert payload["posts"][0]["settings"] == {
            "__type": "x",
            "who_can_reply_post": "everyone",
        }
        assert payload["shortLink"] is False

    def test_x_post_settings_include_reply_audience_for_every_write_type(self) -> None:
        service, client, _repository, _settings_obj = self._ready()
        for post_type in ("now", "schedule", "draft"):
            client.create_post.reset_mock()
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type=post_type,
                content="Hello X",
                publish_date="2026-09-23T15:30:00Z",
            )
            settings = client.create_post.call_args.args[1]["posts"][0]["settings"]
            assert settings["__type"] == "x"
            assert settings["who_can_reply_post"] == "everyone"

    def test_x_single_post_without_thread_keeps_one_value(self) -> None:
        service, client, _repository, _settings_obj = self._ready()
        service.create_x_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="now",
            content="Hello X",
            publish_date="2026-09-23T15:30:00Z",
        )
        post = client.create_post.call_args.args[1]["posts"][0]
        assert post["value"] == [{"content": "Hello X", "image": []}]
        assert post["settings"] == {
            "__type": "x",
            "who_can_reply_post": "everyone",
        }

    def test_x_thread_preserves_order_for_every_write_type(self) -> None:
        service, client, _repository, _settings_obj = self._ready()
        two = ("First", "Second")
        three = ("One", "Two", "Three")
        for post_type in ("now", "schedule", "draft"):
            client.create_post.reset_mock()
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type=post_type,
                content=two[0],
                publish_date="2026-09-23T15:30:00Z",
                thread=two,
            )
            value = client.create_post.call_args.args[1]["posts"][0]["value"]
            assert [item["content"] for item in value] == ["First", "Second"]
            assert value[1]["image"] == []

            client.create_post.reset_mock()
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type=post_type,
                content=three[0],
                publish_date="2026-09-23T15:30:00Z",
                thread=three,
            )
            value = client.create_post.call_args.args[1]["posts"][0]["value"]
            assert value[0]["content"] == "One"
            assert value[1]["content"] == "Two"
            assert value[2]["content"] == "Three"
            assert value[1]["image"] == []
            assert value[2]["image"] == []

    def test_x_thread_sends_original_content_and_limits_trimmed_text(self) -> None:
        from app.services.postiz_posts import MediaRef

        service, client, _repository, _settings_obj = self._ready(max_length=280)
        padded = "  Hello X  "
        service.create_x_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="draft",
            content=padded,
            publish_date="2026-09-23T15:30:00Z",
            thread=(padded, "  Next  "),
            images=[MediaRef(id="img-1", path="https://cdn.example.com/img-1.jpg")],
        )
        value = client.create_post.call_args.args[1]["posts"][0]["value"]
        assert value[0]["content"] == padded
        assert value[0]["image"] == [
            {"id": "img-1", "path": "https://cdn.example.com/img-1.jpg"},
        ]
        assert value[1]["content"] == "  Next  "
        assert value[1]["image"] == []

        with pytest.raises(PostizBadRequestError, match="must not be empty"):
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="First",
                publish_date="2026-09-23T15:30:00Z",
                thread=("First", "   "),
            )

        with pytest.raises(PostizBadRequestError, match="entry 2 must be 1–280"):
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="ok",
                publish_date="2026-09-23T15:30:00Z",
                thread=("ok", f" {'a' * 281} "),
            )

        service.create_x_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="now",
            content="ok",
            publish_date="2026-09-23T15:30:00Z",
            thread=("ok", f" {'a' * 280} "),
        )
        sent = client.create_post.call_args.args[1]["posts"][0]["value"][1]["content"]
        assert sent == f" {'a' * 280} "

    def test_x_thread_request_keeps_original_content_and_rejects_linkedin(self) -> None:
        from pydantic import ValidationError

        from app.api.routes.postiz import CreatePostRequest, XThreadEntryRequest

        with pytest.raises(ValidationError):
            XThreadEntryRequest.model_validate(
                {"content": "reply", "images": [{"id": "x", "path": "https://cdn.example.com/a.jpg"}]},
            )

        body = CreatePostRequest.model_validate(
            {
                "avatar_id": str(AVATAR_A),
                "type": "now",
                "content": "  First  ",
                "publish_date": "2026-09-23T15:30:00Z",
                "platform": "x",
                "posts": [{"content": "  First  "}, {"content": "Second"}],
            },
        )
        assert body.content == "  First  "
        assert body.posts is not None
        assert body.posts[0].content == "  First  "

        with pytest.raises(ValidationError, match="first X thread entry"):
            CreatePostRequest.model_validate(
                {
                    "avatar_id": str(AVATAR_A),
                    "type": "now",
                    "content": "First",
                    "publish_date": "2026-09-23T15:30:00Z",
                    "platform": "x",
                    "posts": [{"content": "  First  "}],
                },
            )

        with pytest.raises(ValidationError, match="only supported for X"):
            CreatePostRequest.model_validate(
                {
                    "avatar_id": str(AVATAR_A),
                    "type": "now",
                    "content": "Hello",
                    "publish_date": "2026-09-23T15:30:00Z",
                    "posts": [{"content": "Hello"}],
                },
            )

    def test_x_posts_are_isolated_by_avatar_token_and_id(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        connections = {
            AVATAR_A: _connection(
                settings=settings,
                avatar_id=AVATAR_A,
                integration_id="li-a",
                x_integration_id="x-a",
                token=b"pos_token_a",
            ),
            AVATAR_B: _connection(
                settings=settings,
                avatar_id=AVATAR_B,
                org_id="org-b",
                integration_id="li-b",
                x_integration_id="x-b",
                token=b"pos_token_b",
            ),
        }
        repository.get_connection.side_effect = lambda avatar_id: connections[avatar_id]
        client.get_integration_settings.return_value = {"output": {"maxLength": 280}}
        client.create_post.return_value = [{"postId": "px"}]
        service = _posts_service(settings=settings, client=client, repository=repository)

        service.create_x_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="now",
            content="From A",
            publish_date="2026-09-23T15:30:00Z",
        )
        service.create_x_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_B,
            post_type="now",
            content="From B",
            publish_date="2026-09-23T15:30:00Z",
        )
        assert client.get_integration_settings.call_args_list[0].args == (
            "pos_token_a",
            "x-a",
        )
        assert client.get_integration_settings.call_args_list[1].args == (
            "pos_token_b",
            "x-b",
        )
        assert client.create_post.call_args_list[0].args[1]["posts"][0]["integration"]["id"] == "x-a"
        assert client.create_post.call_args_list[1].args[1]["posts"][0]["integration"]["id"] == "x-b"
        assert connections[AVATAR_A]["postiz_integration_id"] == "li-a"
        assert connections[AVATAR_B]["postiz_integration_id"] == "li-b"

    def test_x_media_boundaries(self) -> None:
        from app.services.postiz_posts import MediaRef

        service, client, _repository, _settings_obj = self._ready()
        four = [
            MediaRef(id=f"m{i}", path=f"https://cdn.example.com/m{i}.jpg")
            for i in range(4)
        ]
        client.get_media.side_effect = lambda _token, media_id: {
            "id": media_id,
            "path": f"https://cdn.example.com/{media_id}.jpg",
        }
        service.create_x_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="now",
            content="Four",
            publish_date="2026-09-23T15:30:00Z",
            images=four,
        )
        images = client.create_post.call_args.args[1]["posts"][0]["value"][0]["image"]
        assert len(images) == 4

        five = [
            MediaRef(id=f"m{i}", path=f"https://cdn.example.com/m{i}.jpg")
            for i in range(5)
        ]
        with pytest.raises(PostizBadRequestError, match="at most 4"):
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="Five",
                publish_date="2026-09-23T15:30:00Z",
                images=five,
            )

        client.get_media.side_effect = lambda _token, media_id: {
            "id": media_id,
            "path": f"https://cdn.example.com/{media_id}.mp4",
        }
        service.create_x_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="draft",
            content="Video",
            publish_date="2026-09-23T15:30:00Z",
            images=[MediaRef(id="v1", path="https://cdn.example.com/v1.mp4")],
        )
        video = client.create_post.call_args.args[1]["posts"][0]["value"][0]["image"]
        assert video == [{"id": "v1", "path": "https://cdn.example.com/v1.mp4"}]

        with pytest.raises(PostizBadRequestError, match="video and image"):
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="Mix",
                publish_date="2026-09-23T15:30:00Z",
                images=[
                    MediaRef(id="m1", path="https://cdn.example.com/m1.jpg"),
                    MediaRef(id="v1", path="https://cdn.example.com/v1.mp4"),
                ],
            )
        with pytest.raises(PostizBadRequestError, match="at most one video"):
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="Two videos",
                publish_date="2026-09-23T15:30:00Z",
                images=[
                    MediaRef(id="v1", path="https://cdn.example.com/v1.mp4"),
                    MediaRef(id="v2", path="https://cdn.example.com/v2.mp4"),
                ],
            )

    def test_x_length_follows_postiz_max_length(self) -> None:
        service, client, _repository, _settings_obj = self._ready(max_length=280)
        service.create_x_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="now",
            content="a" * 280,
            publish_date="2026-09-23T15:30:00Z",
        )
        with pytest.raises(PostizBadRequestError, match="1–280"):
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="a" * 281,
                publish_date="2026-09-23T15:30:00Z",
            )

        client.get_integration_settings.return_value = {"output": {"maxLength": 4000}}
        service.create_x_post(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            post_type="now",
            content="b" * 4000,
            publish_date="2026-09-23T15:30:00Z",
        )
        with pytest.raises(PostizBadRequestError, match="1–4000"):
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="b" * 4001,
                publish_date="2026-09-23T15:30:00Z",
            )

        for unexpected in (None, "4000", 100, True):
            client.create_post.reset_mock()
            client.get_integration_settings.return_value = {
                "output": {"maxLength": unexpected},
            }
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="c" * 280,
                publish_date="2026-09-23T15:30:00Z",
            )
            with pytest.raises(PostizBadRequestError, match="1–280"):
                service.create_x_post(
                    contos_user_id=USER_A,
                    avatar_id=AVATAR_A,
                    post_type="now",
                    content="c" * 281,
                    publish_date="2026-09-23T15:30:00Z",
                )

        client.get_integration_settings.return_value = {}
        with pytest.raises(PostizBadRequestError, match="1–280"):
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="now",
                content="d" * 281,
                publish_date="2026-09-23T15:30:00Z",
            )

    def test_x_update_edits_draft_and_scheduled_only(self) -> None:
        service, client, _repository, _settings_obj = self._ready()

        def listed(state: str) -> list[dict[str, Any]]:
            return [
                _raw_post(
                    post_id="px",
                    content="Old",
                    integration_id="x-a",
                    state=state,
                ),
            ]

        for state in ("DRAFT", "QUEUE"):
            client.create_post.reset_mock()
            client.get_integration_settings.reset_mock()
            client.list_posts.return_value = listed(state)
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="update",
                content="  Edited  ",
                publish_date="2026-09-23T15:30:00Z",
                post_id="px",
            )
            client.get_integration_settings.assert_called_once_with("pos_token_a", "x-a")
            payload = client.create_post.call_args.args[1]
            assert payload["type"] == "update"
            value = payload["posts"][0]["value"]
            assert value == [
                {"content": "  Edited  ", "image": [], "id": "px"},
            ]
            assert payload["posts"][0]["settings"] == {
                "__type": "x",
                "who_can_reply_post": "everyone",
            }
            assert payload["posts"][0]["integration"]["id"] == "x-a"

        client.create_post.reset_mock()
        client.get_integration_settings.reset_mock()
        client.list_posts.return_value = listed("PUBLISHED")
        with pytest.raises(PostizBadRequestError, match="Only draft and scheduled"):
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="update",
                content="Edit",
                publish_date="2026-09-23T15:30:00Z",
                post_id="px",
            )
        client.get_integration_settings.assert_not_called()
        client.create_post.assert_not_called()

        with pytest.raises(PostizBadRequestError, match="post_id is required"):
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="update",
                content="Edit",
                publish_date="2026-09-23T15:30:00Z",
            )
        with pytest.raises(PostizBadRequestError, match="first post only"):
            service.create_x_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_type="update",
                content="Edit",
                publish_date="2026-09-23T15:30:00Z",
                post_id="px",
                thread=("Edit", "Reply"),
            )

    def test_x_delete_allows_draft_scheduled_and_failed(self) -> None:
        service, client, _repository, _settings_obj = self._ready()
        client.delete_post.return_value = {"id": "px"}

        for state in ("DRAFT", "QUEUE", "ERROR"):
            client.delete_post.reset_mock()
            client.list_posts.return_value = [
                _raw_post(
                    post_id="px",
                    content="Old",
                    integration_id="x-a",
                    state=state,
                ),
            ]
            service.delete_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_id="px",
            )
            client.delete_post.assert_called_once_with("pos_token_a", "px")

        client.delete_post.reset_mock()
        client.list_posts.return_value = [
            _raw_post(
                post_id="px",
                content="Live",
                integration_id="x-a",
                state="PUBLISHED",
            ),
        ]
        with pytest.raises(PostizBadRequestError, match="Only draft, scheduled, and failed"):
            service.delete_post(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                post_id="px",
            )
        client.delete_post.assert_not_called()

    def test_list_returns_linkedin_and_x_posts_for_same_avatar(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            integration_id="li-a",
            x_integration_id="x-a",
            token=b"pos_token_a",
        )
        client.list_posts.return_value = [
            _raw_post(post_id="pli", content="LinkedIn", integration_id="li-a"),
            _raw_post(post_id="px", content="X", integration_id="x-a"),
            _raw_post(post_id="other", content="Other", integration_id="li-b"),
        ]
        service = _posts_service(settings=settings, client=client, repository=repository)
        posts = service.list_posts(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            start_date="2026-09-01T00:00:00.000Z",
            end_date="2026-09-30T23:59:59.000Z",
        )
        assert {post.id for post in posts} == {"pli", "px"}

    def test_x_only_avatar_can_list_and_upload(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            integration_id=None,
            x_integration_id="x-a",
            token=b"pos_token_a",
        )
        client.list_posts.return_value = [
            _raw_post(post_id="px", content="X only", integration_id="x-a"),
            _raw_post(post_id="pli", content="Not ours", integration_id="li-a"),
        ]
        client.upload_file.return_value = {
            "id": "img-1",
            "name": "a.jpg",
            "path": "https://cdn.example.com/a.jpg",
            "originalName": "a.jpg",
        }
        service = _posts_service(settings=settings, client=client, repository=repository)
        posts = service.list_posts(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            start_date="2026-09-01T00:00:00.000Z",
            end_date="2026-09-30T23:59:59.000Z",
        )
        assert [post.id for post in posts] == ["px"]
        media = service.upload_media(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            filename="a.jpg",
            content=b"jpeg-bytes",
            content_type="image/jpeg",
        )
        assert media.id == "img-1"
        assert client.upload_file.call_args.args[0] == "pos_token_a"

    def test_linkedin_only_list_and_upload_ignore_other_channel_ids(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        repository.get_connection.return_value = _connection(
            settings=settings,
            integration_id="li-a",
            x_integration_id=None,
            token=b"pos_token_a",
        )
        client.list_posts.return_value = [
            _raw_post(post_id="pli", content="LinkedIn", integration_id="li-a"),
            _raw_post(post_id="px", content="X", integration_id="x-a"),
        ]
        client.upload_file.return_value = {
            "id": "img-2",
            "path": "https://cdn.example.com/b.jpg",
        }
        service = _posts_service(settings=settings, client=client, repository=repository)
        posts = service.list_posts(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            start_date="2026-09-01T00:00:00.000Z",
            end_date="2026-09-30T23:59:59.000Z",
        )
        assert [post.id for post in posts] == ["pli"]
        service.upload_media(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            filename="b.jpg",
            content=b"jpeg-bytes",
            content_type="image/jpeg",
        )
        assert client.upload_file.call_args.args[0] == "pos_token_a"

    def test_channel_ids_are_not_shared_across_avatars(self) -> None:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        connections = {
            AVATAR_A: _connection(
                settings=settings,
                avatar_id=AVATAR_A,
                integration_id="li-a",
                x_integration_id="x-a",
                token=b"pos_token_a",
            ),
            AVATAR_B: _connection(
                settings=settings,
                avatar_id=AVATAR_B,
                org_id="org-b",
                integration_id="li-b",
                x_integration_id="x-b",
                token=b"pos_token_b",
            ),
        }
        repository.get_connection.side_effect = lambda avatar_id: connections[avatar_id]
        client.list_posts.return_value = [
            _raw_post(post_id="pli-a", content="A LI", integration_id="li-a"),
            _raw_post(post_id="px-a", content="A X", integration_id="x-a"),
            _raw_post(post_id="pli-b", content="B LI", integration_id="li-b"),
            _raw_post(post_id="px-b", content="B X", integration_id="x-b"),
        ]
        service = _posts_service(settings=settings, client=client, repository=repository)
        window = {
            "start_date": "2026-09-01T00:00:00.000Z",
            "end_date": "2026-09-30T23:59:59.000Z",
        }
        a_posts = service.list_posts(contos_user_id=USER_A, avatar_id=AVATAR_A, **window)
        b_posts = service.list_posts(contos_user_id=USER_A, avatar_id=AVATAR_B, **window)
        assert {post.integration_id for post in a_posts} == {"li-a", "x-a"}
        assert {post.integration_id for post in b_posts} == {"li-b", "x-b"}
        assert "li-a" not in {post.integration_id for post in b_posts}
        assert "x-a" not in {post.integration_id for post in b_posts}


def _kolkata(year: int, month: int, day: int, hour: int = 12) -> datetime:
    return datetime(year, month, day, hour, 0, 0, tzinfo=ZoneInfo("Asia/Kolkata"))


class TestPostizMonthlyConsistency:
    """Published LinkedIn/X roots bucketed into one local calendar month."""

    def _service(
        self,
        posts: list[dict[str, Any]] | None,
        *,
        integration_id: str | None = "li-a",
        x_integration_id: str | None = "x-a",
        user_id: UUID = USER_A,
        connected: bool = True,
    ) -> tuple[PostizPostsService, MagicMock]:
        settings = _settings()
        client = MagicMock()
        repository = MagicMock()
        if connected:
            repository.get_connection.return_value = _connection(
                settings=settings,
                avatar_id=AVATAR_A,
                user_id=user_id,
                integration_id=integration_id,
                x_integration_id=x_integration_id,
                token=b"pos_token_a",
            )
        else:
            repository.get_connection.return_value = None
        client.list_posts.return_value = posts or []
        return (
            _posts_service(settings=settings, client=client, repository=repository),
            client,
        )

    def _load(
        self,
        posts: list[dict[str, Any]] | None,
        *,
        month: str,
        now: datetime,
        integration_id: str | None = "li-a",
        x_integration_id: str | None = "x-a",
        user_id: UUID = USER_A,
        connected: bool = True,
        timezone: str = "Asia/Kolkata",
    ):
        service, client = self._service(
            posts,
            integration_id=integration_id,
            x_integration_id=x_integration_id,
            user_id=user_id,
            connected=connected,
        )
        result = service.monthly_consistency(
            contos_user_id=USER_A,
            avatar_id=AVATAR_A,
            month=month,
            timezone_name=timezone,
            now=now,
        )
        return result, client

    def test_current_month_with_no_posts(self) -> None:
        result, _client = self._load([], month="2026-09", now=_kolkata(2026, 9, 29))
        assert result.connected is True
        assert result.posted_days == 0
        assert result.current_streak == 0
        assert result.longest_streak == 0
        assert result.days_in_month == 30
        assert len(result.days) == 30
        assert result.days[0].date == "2026-09-01"
        assert result.days[-1].date == "2026-09-30"
        assert result.days[-1].is_today is False
        assert result.days[28].date == "2026-09-29"
        assert result.days[28].is_today is True
        assert result.days[28].posted is False

    def test_one_published_post_uses_local_day_not_utc_date(self) -> None:
        # 2026-08-31 20:00 UTC is 2026-09-01 01:30 in Asia/Kolkata.
        result, _client = self._load(
            [
                _raw_post(
                    post_id="p1",
                    content="hello",
                    integration_id="li-a",
                    state="PUBLISHED",
                    publish_date="2026-08-31T20:00:00Z",
                ),
            ],
            month="2026-09",
            now=_kolkata(2026, 9, 1, 10),
        )
        assert result.posted_days == 1
        assert result.total_published_posts == 1
        assert result.days[0].posted is True
        assert result.days[0].is_today is True
        assert result.current_streak == 1

    def test_multiple_posts_same_day_count_as_one_posted_day(self) -> None:
        result, _client = self._load(
            [
                _raw_post(
                    post_id="p1",
                    content="a",
                    integration_id="li-a",
                    state="PUBLISHED",
                    publish_date="2026-09-10T04:30:00Z",
                ),
                _raw_post(
                    post_id="p2",
                    content="b",
                    integration_id="li-a",
                    state="PUBLISHED",
                    publish_date="2026-09-10T12:30:00Z",
                ),
            ],
            month="2026-09",
            now=_kolkata(2026, 9, 10),
        )
        assert result.posted_days == 1
        assert result.total_published_posts == 2
        assert result.linkedin_posted_days == 1

    def test_linkedin_and_x_same_day_count_as_one_posted_day(self) -> None:
        result, _client = self._load(
            [
                _raw_post(
                    post_id="li",
                    content="li",
                    integration_id="li-a",
                    state="PUBLISHED",
                    publish_date="2026-09-10T04:30:00Z",
                ),
                _raw_post(
                    post_id="x",
                    content="x",
                    integration_id="x-a",
                    state="PUBLISHED",
                    publish_date="2026-09-10T10:30:00Z",
                ),
            ],
            month="2026-09",
            now=_kolkata(2026, 9, 10),
        )
        assert result.posted_days == 1
        assert result.linkedin_posted_days == 1
        assert result.x_posted_days == 1
        assert result.total_published_posts == 2

    def test_x_thread_root_counts_as_one_posted_day(self) -> None:
        """GET /posts returns the thread root only, so one root is one day."""
        result, _client = self._load(
            [
                _raw_post(
                    post_id="thread-root",
                    content="1/5",
                    integration_id="x-a",
                    state="PUBLISHED",
                    publish_date="2026-09-12T06:00:00Z",
                ),
            ],
            month="2026-09",
            now=_kolkata(2026, 9, 12),
        )
        assert result.posted_days == 1
        assert result.x_posted_days == 1
        assert result.total_published_posts == 1

    def test_draft_queue_error_and_interval_are_ignored(self) -> None:
        day = "2026-09-12T06:00:00Z"
        ignored = []
        for state in ("DRAFT", "QUEUE", "ERROR"):
            ignored.append(
                _raw_post(
                    post_id=state,
                    content=state,
                    integration_id="li-a",
                    state=state,
                    publish_date=day,
                ),
            )
        repeating = _raw_post(
            post_id="repeat",
            content="repeat",
            integration_id="li-a",
            state="PUBLISHED",
            publish_date=day,
        )
        repeating["intervalInDays"] = 7
        child = _raw_post(
            post_id="child",
            content="reply",
            integration_id="x-a",
            state="PUBLISHED",
            publish_date=day,
        )
        child["parentPostId"] = "thread-root"
        result, _client = self._load(
            ignored + [repeating, child],
            month="2026-09",
            now=_kolkata(2026, 9, 12),
        )
        assert result.posted_days == 0
        assert result.total_published_posts == 0

    def test_consecutive_days_and_gap_reset_streak(self) -> None:
        posts = [
            _raw_post(
                post_id=f"d{day}",
                content="x",
                integration_id="li-a",
                state="PUBLISHED",
                publish_date=f"2026-09-{day:02d}T06:00:00Z",
            )
            for day in (1, 2, 3, 5, 6)
        ]
        result, _client = self._load(posts, month="2026-09", now=_kolkata(2026, 9, 6))
        assert result.current_streak == 2
        assert result.longest_streak == 3
        assert result.posted_days == 5

    def test_today_pending_keeps_streak_when_yesterday_posted(self) -> None:
        posts = [
            _raw_post(
                post_id=f"d{day}",
                content="x",
                integration_id="li-a",
                state="PUBLISHED",
                publish_date=f"2026-09-{day:02d}T06:00:00Z",
            )
            for day in (25, 26, 27)
        ]
        result, _client = self._load(posts, month="2026-09", now=_kolkata(2026, 9, 28))
        assert result.days[27].is_today is True
        assert result.days[27].posted is False
        assert result.current_streak == 3
        assert result.longest_streak == 3

    def test_today_pending_and_yesterday_missing_resets_streak(self) -> None:
        posts = [
            _raw_post(
                post_id=f"d{day}",
                content="x",
                integration_id="li-a",
                state="PUBLISHED",
                publish_date=f"2026-09-{day:02d}T06:00:00Z",
            )
            for day in (25, 26, 27)
        ]
        result, _client = self._load(posts, month="2026-09", now=_kolkata(2026, 9, 29))
        assert result.current_streak == 0
        assert result.longest_streak == 3

    def test_historical_month_current_streak_is_null_and_longest_is_inside_month(self) -> None:
        posts = [
            _raw_post(
                post_id=f"d{day}",
                content="x",
                integration_id="li-a",
                state="PUBLISHED",
                publish_date=f"2026-08-{day:02d}T06:00:00Z",
            )
            for day in (1, 2, 3, 4, 10, 11)
        ]
        result, _client = self._load(posts, month="2026-08", now=_kolkata(2026, 9, 2))
        assert result.current_streak is None
        assert result.longest_streak == 4
        assert result.posted_days == 6
        assert all(day.is_today is False for day in result.days)
        assert result.days_in_month == 31

    def test_streak_does_not_cross_month_boundary(self) -> None:
        posts = [
            _raw_post(
                post_id="aug",
                content="aug",
                integration_id="li-a",
                state="PUBLISHED",
                publish_date="2026-08-31T06:00:00Z",
            ),
            _raw_post(
                post_id="sep",
                content="sep",
                integration_id="li-a",
                state="PUBLISHED",
                publish_date="2026-09-01T06:00:00Z",
            ),
        ]
        september, _client = self._load(posts, month="2026-09", now=_kolkata(2026, 9, 2))
        assert september.posted_days == 1
        assert september.current_streak == 1
        assert september.longest_streak == 1
        opening, _client = self._load(
            [posts[0]],
            month="2026-09",
            now=_kolkata(2026, 9, 1, 8),
        )
        assert opening.days[0].posted is False
        assert opening.current_streak == 0
        august, _client = self._load(posts, month="2026-08", now=_kolkata(2026, 9, 2))
        assert august.current_streak is None
        assert august.posted_days == 1
        assert august.longest_streak == 1

    def test_month_lengths(self) -> None:
        february, _client = self._load([], month="2026-02", now=_kolkata(2026, 2, 10))
        september, _client = self._load([], month="2026-09", now=_kolkata(2026, 9, 10))
        october, _client = self._load([], month="2026-10", now=_kolkata(2026, 10, 10))
        assert february.days_in_month == 28
        assert len(february.days) == 28
        assert september.days_in_month == 30
        assert len(september.days) == 30
        assert october.days_in_month == 31
        assert len(october.days) == 31

    def test_invalid_timezone_and_future_month(self) -> None:
        service, _client = self._service([])
        with pytest.raises(PostizBadRequestError, match="IANA"):
            service.monthly_consistency(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                month="2026-09",
                timezone_name="Not/AZone",
                now=_kolkata(2026, 9, 10),
            )
        with pytest.raises(PostizBadRequestError, match="future"):
            service.monthly_consistency(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                month="2099-01",
                timezone_name="Asia/Kolkata",
                now=_kolkata(2026, 9, 10),
            )

    def test_other_integration_and_outside_month_are_ignored(self) -> None:
        result, _client = self._load(
            [
                _raw_post(
                    post_id="other",
                    content="other",
                    integration_id="li-other",
                    state="PUBLISHED",
                    publish_date="2026-09-10T06:00:00Z",
                ),
                _raw_post(
                    post_id="october",
                    content="oct",
                    integration_id="li-a",
                    state="PUBLISHED",
                    publish_date="2026-10-01T06:00:00Z",
                ),
            ],
            month="2026-09",
            now=_kolkata(2026, 9, 15),
        )
        assert result.posted_days == 0
        assert result.total_published_posts == 0

    def test_disconnected_avatar_returns_empty_month_without_postiz_call(self) -> None:
        result, client = self._load(
            [],
            month="2026-09",
            now=_kolkata(2026, 9, 15),
            connected=False,
        )
        assert result.connected is False
        assert result.posted_days == 0
        assert result.current_streak == 0
        assert len(result.days) == 30
        client.list_posts.assert_not_called()

    def test_missing_channel_ids_are_disconnected(self) -> None:
        result, client = self._load(
            [],
            month="2026-09",
            now=_kolkata(2026, 9, 15),
            integration_id=None,
            x_integration_id=None,
        )
        assert result.connected is False
        client.list_posts.assert_not_called()

    def test_query_window_is_the_local_month(self) -> None:
        _result, client = self._load([], month="2026-09", now=_kolkata(2026, 9, 15))
        client.list_posts.assert_called_once()
        _token, kwargs = client.list_posts.call_args.args[0], client.list_posts.call_args.kwargs
        assert kwargs["start_date"] == "2026-09-01T00:00:00+05:30"
        assert kwargs["end_date"] == "2026-09-30T23:59:59+05:30"
        assert _token == client.list_posts.call_args.args[0]

    def test_connection_for_another_user_is_rejected(self) -> None:
        service, _client = self._service([], user_id=USER_B)
        with pytest.raises(RepositoryError, match="different ContOS user"):
            service.monthly_consistency(
                contos_user_id=USER_A,
                avatar_id=AVATAR_A,
                month="2026-09",
                timezone_name="Asia/Kolkata",
                now=_kolkata(2026, 9, 15),
            )

    def test_consistency_route_auth_timezone_and_ownership(self) -> None:
        from app.api.deps import get_current_user_id
        from app.main import app

        client = TestClient(app)
        assert (
            client.get(
                f"/api/postiz/consistency?avatar_id={AVATAR_A}&month=2026-09&timezone=Asia/Kolkata",
            ).status_code
            == 401
        )

        app.dependency_overrides[get_current_user_id] = lambda: USER_A
        try:
            with patch("app.api.routes.postiz.SupabaseRepository") as repo_cls:
                repo_cls.return_value.verify_avatar_owner.side_effect = RepositoryError(
                    "Avatar not found or you do not have permission to access it.",
                )
                denied = client.get(
                    f"/api/postiz/consistency?avatar_id={AVATAR_B}&month=2026-09&timezone=Asia/Kolkata",
                )
                assert denied.status_code == 404

            with patch("app.api.routes.postiz.SupabaseRepository") as repo_cls:
                repo_cls.return_value.verify_avatar_owner.return_value = None
                with patch("app.api.routes.postiz._get_posts_service") as posts_factory:
                    service, _postiz = self._service([])
                    posts_factory.return_value = service
                    bad_zone = client.get(
                        f"/api/postiz/consistency?avatar_id={AVATAR_A}&month=2026-09&timezone=Not/AZone",
                    )
                    assert bad_zone.status_code == 400
                    assert "IANA" in bad_zone.json()["detail"]
                    future = client.get(
                        f"/api/postiz/consistency?avatar_id={AVATAR_A}&month=2099-01&timezone=Asia/Kolkata",
                    )
                    assert future.status_code == 400
        finally:
            app.dependency_overrides.clear()
