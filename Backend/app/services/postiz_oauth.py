"""ContOS Postiz orchestration: avatar-scoped provision, LinkedIn connect, status."""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import redis
from cryptography.fernet import Fernet, InvalidToken

from app.clients.postiz_client import PostizClient
from app.clients.postiz_repository import PostizRepository
from app.config import Settings, get_settings
from app.errors import (
    ConfigurationError,
    PostizAuthorizationInvalidError,
    PostizIntegrationClaimError,
    PostizServiceError,
)

logger = logging.getLogger(__name__)

_STATUS_CACHE_TTL_SECS = 5
_LINKEDIN_SNAPSHOT_TTL_SECS = 900
_LINKEDIN_PROVIDER = "linkedin"


@dataclass(frozen=True)
class SafeIntegration:
    id: str
    name: str
    identifier: str
    picture: str | None


@dataclass(frozen=True)
class PostizStatus:
    connected: bool
    integration: SafeIntegration | None
    claim_candidates: tuple[SafeIntegration, ...] = ()


@dataclass(frozen=True)
class ConnectResult:
    authorization_url: str
    flow: str  # "linkedin"


def require_postiz_settings(settings: Settings | None = None) -> Settings:
    resolved = settings or get_settings()
    missing: list[str] = []
    if not resolved.postiz_base_url:
        missing.append("POSTIZ_URL")
    if not resolved.contos_provision_secret.strip():
        missing.append("CONTOS_PROVISION_SECRET")
    if not resolved.postiz_token_encryption_key:
        missing.append("POSTIZ_TOKEN_ENCRYPTION_KEY")
    if missing:
        raise ConfigurationError(
            "Missing required Postiz configuration: " + ", ".join(missing),
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

    def ensure_avatar_connection(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
    ) -> dict[str, Any]:
        """Return a working avatar-scoped Postiz connection, provisioning if needed."""
        connection = self._repository.get_connection(avatar_id)
        if connection is not None:
            if str(connection.get("contos_user_id")) != str(contos_user_id):
                raise PostizServiceError(
                    "Postiz connection for this avatar belongs to a different ContOS user.",
                )
            try:
                access_token = self._decrypt_token(connection["encrypted_access_token"])
                self._client.list_integrations(access_token)
                return connection
            except PostizAuthorizationInvalidError:
                logger.warning(
                    "Stored Postiz authorization is invalid; re-provisioning avatar org",
                    extra={
                        "contos_user_id": str(contos_user_id),
                        "avatar_id": str(avatar_id),
                    },
                )
                self._repository.delete_connection(avatar_id)
                self._clear_status_cache(avatar_id)
                self._clear_linkedin_snapshot(avatar_id)

        provisioned = self._client.provision_avatar(avatar_id)
        encrypted = self._encrypt_token(provisioned["access_token"])
        connection = self._repository.upsert_connection(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
            postiz_organization_id=provisioned["organization_id"],
            encrypted_access_token=encrypted,
        )
        logger.info(
            "Provisioned avatar-scoped Postiz connection",
            extra={
                "contos_user_id": str(contos_user_id),
                "avatar_id": str(avatar_id),
                "postiz_organization_id": provisioned["organization_id"],
                "provision_created": bool(provisioned.get("created")),
            },
        )
        return connection

    def start_connect(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
    ) -> ConnectResult:
        connection = self.ensure_avatar_connection(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )
        org_id = str(connection.get("postiz_organization_id") or "")
        access_token = self._decrypt_token(connection["encrypted_access_token"])
        try:
            integrations = self._client.list_integrations(access_token)
            self._store_linkedin_snapshot(avatar_id, integrations)
            linkedin_url = self._client.get_linkedin_authorization_url(access_token)
        except PostizAuthorizationInvalidError:
            self._repository.delete_connection(avatar_id)
            self._clear_status_cache(avatar_id)
            self._clear_linkedin_snapshot(avatar_id)
            raise
        except PostizServiceError as error:
            logger.warning(
                "Failed to start LinkedIn connect for avatar",
                extra={
                    "contos_user_id": str(contos_user_id),
                    "avatar_id": str(avatar_id),
                    "postiz_organization_id": org_id,
                    "error_type": type(error).__name__,
                },
            )
            raise

        logger.info(
            "Starting avatar-scoped LinkedIn OAuth",
            extra={
                "contos_user_id": str(contos_user_id),
                "avatar_id": str(avatar_id),
                "postiz_organization_id": org_id,
                "snapshot_count": len(self._map_linkedin_integrations(integrations)),
            },
        )
        return ConnectResult(authorization_url=linkedin_url, flow="linkedin")

    def get_status(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
    ) -> PostizStatus:
        if self._load_linkedin_snapshot(avatar_id) is None:
            cached = self._get_status_cache(avatar_id)
            if cached is not None:
                return cached

        connection = self._repository.get_connection(avatar_id)
        if connection is None:
            logger.info(
                "Postiz status: no avatar-scoped connection",
                extra={
                    "contos_user_id": str(contos_user_id),
                    "avatar_id": str(avatar_id),
                },
            )
            status = PostizStatus(connected=False, integration=None)
            self._set_status_cache(avatar_id, status)
            return status

        if str(connection.get("contos_user_id")) != str(contos_user_id):
            raise PostizServiceError(
                "Postiz connection for this avatar belongs to a different ContOS user.",
            )

        org_id = str(connection.get("postiz_organization_id") or "")
        try:
            access_token = self._decrypt_token(connection["encrypted_access_token"])
            integrations = self._client.list_integrations(access_token)
        except PostizAuthorizationInvalidError:
            self._repository.delete_connection(avatar_id)
            self._clear_status_cache(avatar_id)
            self._clear_linkedin_snapshot(avatar_id)
            raise

        stored_id = connection.get("postiz_integration_id")
        stored_id_str = (
            stored_id.strip()
            if isinstance(stored_id, str) and stored_id.strip()
            else None
        )

        if stored_id_str:
            matched = self._find_linkedin_by_id(integrations, stored_id_str)
            if matched is None:
                logger.info(
                    "Stored Postiz LinkedIn integration not returned by Postiz",
                    extra={
                        "contos_user_id": str(contos_user_id),
                        "avatar_id": str(avatar_id),
                        "postiz_organization_id": org_id,
                        "reason": "integration_not_found",
                        "postiz_integration_id": stored_id_str,
                    },
                )
                status = PostizStatus(connected=False, integration=None)
                self._set_status_cache(avatar_id, status)
                return status

            logger.info(
                "Postiz status: connected for avatar org",
                extra={
                    "contos_user_id": str(contos_user_id),
                    "avatar_id": str(avatar_id),
                    "postiz_organization_id": org_id,
                    "postiz_integration_id": stored_id_str,
                },
            )
            status = PostizStatus(connected=True, integration=matched)
            self._set_status_cache(avatar_id, status)
            return status

        claimed = self._try_claim_from_snapshot(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
            integrations=integrations,
        )
        if claimed is not None:
            status = PostizStatus(connected=True, integration=claimed)
            self._set_status_cache(avatar_id, status)
            return status

        snapshot_ids = self._load_linkedin_snapshot(avatar_id)
        if snapshot_ids is not None:
            candidates = self._unclaimed_linkedin_integrations(integrations)
            if candidates:
                return PostizStatus(
                    connected=False,
                    integration=None,
                    claim_candidates=candidates,
                )

        status = PostizStatus(connected=False, integration=None)
        self._set_status_cache(avatar_id, status)
        return status

    def claim_linkedin_integration(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        integration_id: str,
    ) -> PostizStatus:
        """Bind an unclaimed LinkedIn integration during an active connect session."""
        integration_id = integration_id.strip()
        if not integration_id:
            raise PostizIntegrationClaimError("integration_id is required.")

        snapshot_ids = self._load_linkedin_snapshot(avatar_id)
        if snapshot_ids is None:
            raise PostizIntegrationClaimError(
                "No active LinkedIn connect session. Start Connect LinkedIn again.",
            )

        connection = self._repository.get_connection(avatar_id)
        if connection is None:
            raise PostizServiceError("No Postiz connection found for this avatar.")
        if str(connection.get("contos_user_id")) != str(contos_user_id):
            raise PostizServiceError(
                "Postiz connection for this avatar belongs to a different ContOS user.",
            )

        access_token = self._decrypt_token(connection["encrypted_access_token"])
        try:
            integrations = self._client.list_integrations(access_token)
        except PostizAuthorizationInvalidError:
            self._repository.delete_connection(avatar_id)
            self._clear_status_cache(avatar_id)
            self._clear_linkedin_snapshot(avatar_id)
            raise

        matched = self._find_linkedin_by_id(integrations, integration_id)
        if matched is None:
            raise PostizIntegrationClaimError(
                "That LinkedIn account was not found on this avatar's Postiz organization.",
            )

        owner = self._repository.get_connection_by_integration_id(integration_id)
        if owner is not None:
            owner_avatar = owner.get("avatar_id")
            if owner_avatar is not None and str(owner_avatar) != str(avatar_id):
                raise PostizIntegrationClaimError(
                    "This LinkedIn integration is already linked to another ContOS avatar.",
                )
            if str(owner.get("contos_user_id")) != str(contos_user_id):
                raise PostizIntegrationClaimError(
                    "This LinkedIn integration is already linked to another ContOS account.",
                )

        self._repository.claim_integration(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
            postiz_integration_id=integration_id,
        )
        self._clear_linkedin_snapshot(avatar_id)
        self._clear_status_cache(avatar_id)

        return PostizStatus(connected=True, integration=matched)

    def _try_claim_from_snapshot(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        integrations: list[dict[str, Any]],
    ) -> SafeIntegration | None:
        snapshot_ids = self._load_linkedin_snapshot(avatar_id)
        if snapshot_ids is None:
            return None

        current = self._map_linkedin_integrations(integrations)
        current_ids = {item.id for item in current}
        new_ids = sorted(current_ids - snapshot_ids)
        candidate_pool = new_ids if new_ids else sorted(current_ids)

        unclaimed: list[str] = []
        for integration_id in candidate_pool:
            owner = self._repository.get_connection_by_integration_id(integration_id)
            if owner is None:
                unclaimed.append(integration_id)
            elif str(owner.get("avatar_id")) == str(avatar_id):
                # Already ours — treat as claimed path handled elsewhere.
                continue

        if len(unclaimed) != 1:
            if len(unclaimed) > 1:
                logger.warning(
                    "Ambiguous LinkedIn integrations after OAuth; not claiming",
                    extra={
                        "contos_user_id": str(contos_user_id),
                        "avatar_id": str(avatar_id),
                        "candidate_count": len(unclaimed),
                        "new_id_count": len(new_ids),
                    },
                )
            return None

        candidate_id = unclaimed[0]
        try:
            self._repository.claim_integration(
                contos_user_id=contos_user_id,
                avatar_id=avatar_id,
                postiz_integration_id=candidate_id,
            )
        except PostizIntegrationClaimError:
            logger.warning(
                "Failed to claim LinkedIn integration (already owned or race)",
                extra={
                    "contos_user_id": str(contos_user_id),
                    "avatar_id": str(avatar_id),
                    "postiz_integration_id": candidate_id,
                },
            )
            return None

        matched = self._find_linkedin_by_id(integrations, candidate_id)
        if matched is None:
            return None
        self._clear_linkedin_snapshot(avatar_id)
        return matched

    def _unclaimed_linkedin_integrations(
        self,
        integrations: list[dict[str, Any]],
    ) -> tuple[SafeIntegration, ...]:
        candidates: list[SafeIntegration] = []
        for item in self._map_linkedin_integrations(integrations):
            owner = self._repository.get_connection_by_integration_id(item.id)
            if owner is None:
                candidates.append(item)
        return tuple(candidates)

    def _map_linkedin_integrations(
        self,
        integrations: list[dict[str, Any]],
    ) -> tuple[SafeIntegration, ...]:
        mapped: list[SafeIntegration] = []
        for item in integrations:
            parsed = self._parse_linkedin_integration(item)
            if parsed is not None:
                mapped.append(parsed)
        return tuple(mapped)

    def _find_linkedin_by_id(
        self,
        integrations: list[dict[str, Any]],
        integration_id: str,
    ) -> SafeIntegration | None:
        for item in integrations:
            parsed = self._parse_linkedin_integration(item)
            if parsed is not None and parsed.id == integration_id:
                return parsed
        return None

    def _parse_linkedin_integration(self, item: Any) -> SafeIntegration | None:
        if not isinstance(item, dict):
            return None
        identifier = item.get("identifier")
        disabled = item.get("disabled")
        channel_id = item.get("id")
        name = item.get("name")
        picture = item.get("picture")
        if identifier != _LINKEDIN_PROVIDER:
            return None
        if disabled is True:
            return None
        if not isinstance(channel_id, str) or not channel_id.strip():
            return None
        display_name = name if isinstance(name, str) and name.strip() else "LinkedIn"
        picture_url = picture if isinstance(picture, str) and picture.strip() else None
        return SafeIntegration(
            id=channel_id.strip(),
            name=display_name,
            identifier=_LINKEDIN_PROVIDER,
            picture=picture_url,
        )

    def decrypt_access_token(self, encrypted_access_token: str) -> str:
        """Decrypt a stored Fernet token for avatar-scoped Postiz API calls."""
        return self._decrypt_token(encrypted_access_token)

    def clear_avatar_caches(self, avatar_id: UUID) -> None:
        """Drop status/snapshot caches for one avatar (e.g. after disconnect)."""
        self._clear_status_cache(avatar_id)
        self._clear_linkedin_snapshot(avatar_id)

    def _encrypt_token(self, access_token: str) -> str:
        return self._fernet.encrypt(access_token.encode("utf-8")).decode("utf-8")

    def _decrypt_token(self, encrypted_access_token: str) -> str:
        try:
            return self._fernet.decrypt(encrypted_access_token.encode("utf-8")).decode(
                "utf-8",
            )
        except InvalidToken as error:
            raise PostizServiceError(
                "Failed to decrypt stored Postiz access token; encryption key may be wrong.",
            ) from error

    def _status_redis_key(self, avatar_id: UUID) -> str:
        return f"postiz:status:{avatar_id}"

    def _snapshot_redis_key(self, avatar_id: UUID) -> str:
        return f"postiz:linkedin:snapshot:{avatar_id}"

    def _store_linkedin_snapshot(
        self,
        avatar_id: UUID,
        integrations: list[dict[str, Any]],
    ) -> None:
        ids = sorted({item.id for item in self._map_linkedin_integrations(integrations)})
        payload = json.dumps({"linkedin_ids": ids})
        self._redis.set(
            self._snapshot_redis_key(avatar_id),
            payload,
            ex=_LINKEDIN_SNAPSHOT_TTL_SECS,
        )
        logger.info(
            "Stored LinkedIn integration snapshot before OAuth",
            extra={
                "avatar_id": str(avatar_id),
                "snapshot_count": len(ids),
                "ttl_secs": _LINKEDIN_SNAPSHOT_TTL_SECS,
            },
        )

    def _load_linkedin_snapshot(self, avatar_id: UUID) -> set[str] | None:
        raw = self._redis.get(self._snapshot_redis_key(avatar_id))
        if raw is None:
            return None
        try:
            data = json.loads(raw)
            ids = data.get("linkedin_ids", [])
            if not isinstance(ids, list):
                return None
            return {str(item) for item in ids if isinstance(item, str) and item}
        except (TypeError, ValueError, json.JSONDecodeError):
            self._clear_linkedin_snapshot(avatar_id)
            return None

    def _clear_linkedin_snapshot(self, avatar_id: UUID) -> None:
        self._redis.delete(self._snapshot_redis_key(avatar_id))

    def _get_status_cache(self, avatar_id: UUID) -> PostizStatus | None:
        raw = self._redis.get(self._status_redis_key(avatar_id))
        if raw is None:
            return None
        try:
            data = json.loads(raw)
            integration_raw = data.get("integration")
            integration: SafeIntegration | None = None
            if isinstance(integration_raw, dict):
                picture = integration_raw.get("picture")
                integration = SafeIntegration(
                    id=integration_raw["id"],
                    name=integration_raw["name"],
                    identifier=integration_raw["identifier"],
                    picture=picture if isinstance(picture, str) else None,
                )
            return PostizStatus(
                connected=bool(data.get("connected")),
                integration=integration,
            )
        except (TypeError, ValueError, KeyError, json.JSONDecodeError):
            self._clear_status_cache(avatar_id)
            return None

    def _set_status_cache(self, avatar_id: UUID, status: PostizStatus) -> None:
        if status.claim_candidates:
            return
        payload: dict[str, Any] = {
            "connected": status.connected,
            "integration": None,
        }
        if status.integration is not None:
            payload["integration"] = {
                "id": status.integration.id,
                "name": status.integration.name,
                "identifier": status.integration.identifier,
                "picture": status.integration.picture,
            }
        self._redis.set(
            self._status_redis_key(avatar_id),
            json.dumps(payload),
            ex=_STATUS_CACHE_TTL_SECS,
        )

    def _clear_status_cache(self, avatar_id: UUID) -> None:
        self._redis.delete(self._status_redis_key(avatar_id))
