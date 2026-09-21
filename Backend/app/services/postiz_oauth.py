"""ContOS Postiz OAuth orchestration: state, encryption, connect, callback, status."""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlparse
from uuid import UUID

import redis
from cryptography.fernet import Fernet, InvalidToken

from app.clients.postiz_client import PostizClient
from app.clients.postiz_repository import PostizRepository
from app.config import Settings, get_settings
from app.errors import (
    ConfigurationError,
    PostizAuthorizationInvalidError,
    PostizOAuthStateError,
    PostizServiceError,
)

logger = logging.getLogger(__name__)

_OAUTH_STATE_TTL_SECS = 600
_STATUS_CACHE_TTL_SECS = 5
_LINKEDIN_PROVIDER = "linkedin"

_CONSUME_STATE_SCRIPT = """
local value = redis.call("GET", KEYS[1])
if value then
  redis.call("DEL", KEYS[1])
end
return value
"""


@dataclass(frozen=True)
class SafeChannel:
    id: str
    provider: str
    name: str


@dataclass(frozen=True)
class PostizStatus:
    connected: bool
    channels: tuple[SafeChannel, ...]


@dataclass(frozen=True)
class ConnectResult:
    authorization_url: str
    flow: str  # "postiz_consent" | "linkedin"


def require_postiz_settings(settings: Settings | None = None) -> Settings:
    resolved = settings or get_settings()
    missing: list[str] = []
    if not resolved.postiz_base_url:
        missing.append("POSTIZ_URL")
    if not resolved.postiz_client_id:
        missing.append("POSTIZ_CLIENT_ID")
    if not resolved.postiz_client_secret:
        missing.append("POSTIZ_CLIENT_SECRET")
    if not resolved.postiz_redirect_uri:
        missing.append("POSTIZ_REDIRECT_URI")
    if not resolved.postiz_token_encryption_key:
        missing.append("POSTIZ_TOKEN_ENCRYPTION_KEY")
    if missing:
        raise ConfigurationError(
            "Missing required Postiz configuration: " + ", ".join(missing),
        )

    redirect = resolved.postiz_redirect_uri.strip()
    parsed = urlparse(redirect)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ConfigurationError(
            "POSTIZ_REDIRECT_URI must be an absolute http(s) URL.",
        )
    if not parsed.path.rstrip("/").endswith("/auth/postiz/callback"):
        raise ConfigurationError(
            "POSTIZ_REDIRECT_URI must end with /auth/postiz/callback.",
        )
    return resolved


class PostizOAuthService:
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        client: PostizClient | None = None,
        repository: PostizRepository | None = None,
        redis_client: redis.Redis | None = None,
    ) -> None:
        self._settings = require_postiz_settings(settings)
        self._client = client or PostizClient(self._settings)
        self._repository = repository or PostizRepository(self._settings)
        self._redis = redis_client or redis.Redis.from_url(
            self._settings.redis_url,
            decode_responses=True,
        )
        try:
            self._fernet = Fernet(self._settings.postiz_token_encryption_key.encode("utf-8"))
        except (ValueError, TypeError) as error:
            raise ConfigurationError(
                "POSTIZ_TOKEN_ENCRYPTION_KEY is not a valid Fernet key.",
            ) from error

    def start_connect(self, contos_user_id: UUID) -> ConnectResult:
        connection = self._repository.get_connection(contos_user_id)
        if connection is not None:
            try:
                access_token = self._decrypt_token(connection["encrypted_access_token"])
                # Validate token still works before skipping Postiz consent.
                self._client.list_integrations(access_token)
                linkedin_url = self._client.get_linkedin_authorization_url(access_token)
                return ConnectResult(authorization_url=linkedin_url, flow="linkedin")
            except PostizAuthorizationInvalidError:
                logger.warning(
                    "Stored Postiz authorization is invalid; requiring fresh consent",
                    extra={"contos_user_id": str(contos_user_id)},
                )
                self._repository.delete_connection(contos_user_id)
                self._clear_status_cache(contos_user_id)
            except PostizServiceError as error:
                logger.warning(
                    "Failed to resume LinkedIn connect with stored Postiz token",
                    extra={
                        "contos_user_id": str(contos_user_id),
                        "error_type": type(error).__name__,
                    },
                )
                raise

        state = secrets.token_urlsafe(32)
        self._store_oauth_state(state=state, contos_user_id=contos_user_id)
        consent_url = self.build_postiz_consent_url(state)
        return ConnectResult(authorization_url=consent_url, flow="postiz_consent")

    def complete_oauth_callback(
        self,
        *,
        contos_user_id: UUID,
        code: str,
        state: str,
    ) -> ConnectResult:
        if not code or not code.strip():
            raise PostizServiceError("Postiz authorization code is required.")
        if not state or not state.strip():
            raise PostizOAuthStateError("OAuth state is required.")

        bound_user_id = self._consume_oauth_state(state.strip())
        if bound_user_id != contos_user_id:
            raise PostizOAuthStateError(
                "OAuth state does not match the authenticated ContOS user.",
            )

        token_payload = self._client.exchange_code_for_token(code.strip())
        encrypted = self._encrypt_token(token_payload["access_token"])
        self._repository.upsert_connection(
            contos_user_id=contos_user_id,
            postiz_organization_id=token_payload["id"],
            encrypted_access_token=encrypted,
        )
        self._clear_status_cache(contos_user_id)

        linkedin_url = self._client.get_linkedin_authorization_url(
            token_payload["access_token"],
        )
        return ConnectResult(authorization_url=linkedin_url, flow="linkedin")

    def get_status(self, contos_user_id: UUID) -> PostizStatus:
        cached = self._get_status_cache(contos_user_id)
        if cached is not None:
            return cached

        connection = self._repository.get_connection(contos_user_id)
        if connection is None:
            status = PostizStatus(connected=False, channels=())
            self._set_status_cache(contos_user_id, status)
            return status

        try:
            access_token = self._decrypt_token(connection["encrypted_access_token"])
            integrations = self._client.list_integrations(access_token)
        except PostizAuthorizationInvalidError:
            self._repository.delete_connection(contos_user_id)
            self._clear_status_cache(contos_user_id)
            raise

        channels = self._map_safe_channels(integrations)
        linkedin_connected = any(
            channel.provider == _LINKEDIN_PROVIDER for channel in channels
        )
        status = PostizStatus(connected=linkedin_connected, channels=channels)
        self._set_status_cache(contos_user_id, status)
        return status

    def build_postiz_consent_url(self, state: str) -> str:
        """Build the Postiz frontend consent URL with a trusted returnUrl resume param."""
        base = self._settings.postiz_base_url
        query = (
            f"client_id={quote(self._settings.postiz_client_id, safe='')}"
            f"&response_type=code"
            f"&state={quote(state, safe='')}"
        )
        consent_without_return = f"{base}/oauth/authorize?{query}"
        # returnUrl resumes the same consent URL after Postiz login/register.
        return_url = quote(consent_without_return, safe="")
        consent_url = f"{consent_without_return}&returnUrl={return_url}"
        self._client.validate_navigation_url(consent_url, allow_linkedin=False)
        return consent_url

    def _map_safe_channels(self, integrations: list[dict[str, Any]]) -> tuple[SafeChannel, ...]:
        channels: list[SafeChannel] = []
        for item in integrations:
            if not isinstance(item, dict):
                continue
            identifier = item.get("identifier")
            disabled = item.get("disabled")
            channel_id = item.get("id")
            name = item.get("name")
            if identifier != _LINKEDIN_PROVIDER:
                continue
            if disabled is True:
                continue
            if not isinstance(channel_id, str) or not channel_id:
                continue
            display_name = name if isinstance(name, str) and name.strip() else "LinkedIn"
            channels.append(
                SafeChannel(id=channel_id, provider=_LINKEDIN_PROVIDER, name=display_name),
            )
        return tuple(channels)

    def _encrypt_token(self, access_token: str) -> str:
        return self._fernet.encrypt(access_token.encode("utf-8")).decode("utf-8")

    def _decrypt_token(self, encrypted_access_token: str) -> str:
        try:
            return self._fernet.decrypt(encrypted_access_token.encode("utf-8")).decode("utf-8")
        except InvalidToken as error:
            raise PostizServiceError(
                "Failed to decrypt stored Postiz access token; encryption key may be wrong.",
            ) from error

    def _state_redis_key(self, state: str) -> str:
        digest = hashlib.sha256(state.encode("utf-8")).hexdigest()
        return f"postiz:oauth:state:{digest}"

    def _status_redis_key(self, contos_user_id: UUID) -> str:
        return f"postiz:status:{contos_user_id}"

    def _store_oauth_state(self, *, state: str, contos_user_id: UUID) -> None:
        key = self._state_redis_key(state)
        payload = json.dumps({"contos_user_id": str(contos_user_id)})
        stored = self._redis.set(key, payload, nx=True, ex=_OAUTH_STATE_TTL_SECS)
        if not stored:
            raise PostizServiceError("Failed to store OAuth state; please retry.")
        logger.info(
            "Stored Postiz OAuth state",
            extra={
                "contos_user_id": str(contos_user_id),
                "ttl_secs": _OAUTH_STATE_TTL_SECS,
            },
        )

    def _consume_oauth_state(self, state: str) -> UUID:
        key = self._state_redis_key(state)
        # Atomic consume to prevent replay (GET + DEL in one Redis round-trip).
        raw = self._redis.eval(_CONSUME_STATE_SCRIPT, 1, key)
        if raw is None:
            raise PostizOAuthStateError(
                "OAuth state is missing, expired, or has already been used.",
            )
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        try:
            payload = json.loads(raw)
            user_id = UUID(payload["contos_user_id"])
        except (TypeError, ValueError, KeyError, json.JSONDecodeError) as error:
            raise PostizOAuthStateError("OAuth state payload is corrupt.") from error
        return user_id

    def _get_status_cache(self, contos_user_id: UUID) -> PostizStatus | None:
        raw = self._redis.get(self._status_redis_key(contos_user_id))
        if raw is None:
            return None
        try:
            data = json.loads(raw)
            channels = tuple(
                SafeChannel(
                    id=item["id"],
                    provider=item["provider"],
                    name=item["name"],
                )
                for item in data.get("channels", [])
            )
            return PostizStatus(connected=bool(data.get("connected")), channels=channels)
        except (TypeError, ValueError, KeyError, json.JSONDecodeError):
            self._clear_status_cache(contos_user_id)
            return None

    def _set_status_cache(self, contos_user_id: UUID, status: PostizStatus) -> None:
        payload = {
            "connected": status.connected,
            "channels": [
                {"id": channel.id, "provider": channel.provider, "name": channel.name}
                for channel in status.channels
            ],
        }
        self._redis.set(
            self._status_redis_key(contos_user_id),
            json.dumps(payload),
            ex=_STATUS_CACHE_TTL_SECS,
        )

    def _clear_status_cache(self, contos_user_id: UUID) -> None:
        self._redis.delete(self._status_redis_key(contos_user_id))
