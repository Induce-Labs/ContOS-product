"""Supabase persistence for ContOS ↔ Postiz avatar-scoped organization connections."""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from postgrest.exceptions import APIError
from supabase import Client, create_client

from app.config import Settings
from app.errors import ConfigurationError, PostizIntegrationClaimError, RepositoryError

logger = logging.getLogger(__name__)

_TABLE = "postiz_connections"
_SELECT_COLS = (
    "id, contos_user_id, avatar_id, postiz_organization_id, encrypted_access_token, "
    "postiz_integration_id, created_at, updated_at"
)


def _is_unique_violation(error: BaseException) -> bool:
    if isinstance(error, APIError):
        code = str(getattr(error, "code", "") or "")
        message = str(getattr(error, "message", "") or error).lower()
        return code == "23505" or "duplicate" in message or "unique" in message
    message = str(error).lower()
    return "23505" in message or "duplicate" in message or "unique" in message


class PostizRepository:
    def __init__(self, settings: Settings) -> None:
        if not settings.supabase_service_role_key:
            raise ConfigurationError(
                "SUPABASE_SERVICE_ROLE_KEY is required for Postiz connection storage.",
            )
        self._client: Client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
        )

    def get_connection(self, avatar_id: UUID) -> dict[str, Any] | None:
        """Load the connection for a specific avatar. Never matches legacy null avatar_id."""
        response = (
            self._client.table(_TABLE)
            .select(_SELECT_COLS)
            .eq("avatar_id", str(avatar_id))
            .limit(1)
            .execute()
        )
        rows = [] if response is None else (response.data or [])
        if not rows:
            return None
        return rows[0]

    def get_connection_by_integration_id(
        self,
        postiz_integration_id: str,
    ) -> dict[str, Any] | None:
        integration_id = postiz_integration_id.strip()
        if not integration_id:
            raise RepositoryError("postiz_integration_id is required.")
        response = (
            self._client.table(_TABLE)
            .select(_SELECT_COLS)
            .eq("postiz_integration_id", integration_id)
            .limit(1)
            .execute()
        )
        rows = [] if response is None else (response.data or [])
        if not rows:
            return None
        return rows[0]

    def upsert_connection(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        postiz_organization_id: str,
        encrypted_access_token: str,
    ) -> dict[str, Any]:
        """Upsert org token for an avatar. Never updates legacy avatar_id IS NULL rows."""
        if not postiz_organization_id.strip():
            raise RepositoryError("postiz_organization_id is required.")
        if not encrypted_access_token.strip():
            raise RepositoryError("encrypted_access_token is required.")

        existing = self.get_connection(avatar_id)
        if existing is not None:
            existing_owner = existing.get("contos_user_id")
            if str(existing_owner) != str(contos_user_id):
                raise RepositoryError(
                    f"Postiz connection for avatar {avatar_id} belongs to a different ContOS user.",
                )
            response = (
                self._client.table(_TABLE)
                .update(
                    {
                        "postiz_organization_id": postiz_organization_id.strip(),
                        "encrypted_access_token": encrypted_access_token,
                        "contos_user_id": str(contos_user_id),
                    },
                )
                .eq("avatar_id", str(avatar_id))
                .execute()
            )
        else:
            response = (
                self._client.table(_TABLE)
                .insert(
                    {
                        "contos_user_id": str(contos_user_id),
                        "avatar_id": str(avatar_id),
                        "postiz_organization_id": postiz_organization_id.strip(),
                        "encrypted_access_token": encrypted_access_token,
                    },
                )
                .execute()
            )

        rows = [] if response is None else (response.data or [])
        if not rows:
            raise RepositoryError(
                f"Failed to upsert Postiz connection for avatar {avatar_id}.",
            )

        logger.info(
            "Upserted Postiz connection",
            extra={
                "contos_user_id": str(contos_user_id),
                "avatar_id": str(avatar_id),
                "postiz_organization_id": postiz_organization_id,
            },
        )
        return rows[0]

    def claim_integration(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        postiz_integration_id: str,
    ) -> dict[str, Any]:
        """Assign a LinkedIn integration to this avatar (idempotent). Cross-avatar claim rejected."""
        integration_id = postiz_integration_id.strip()
        if not integration_id:
            raise RepositoryError("postiz_integration_id is required.")

        current = self.get_connection(avatar_id)
        if current is None:
            raise RepositoryError(
                f"No Postiz connection exists for avatar {avatar_id}.",
            )
        if str(current.get("contos_user_id")) != str(contos_user_id):
            raise RepositoryError(
                f"Postiz connection for avatar {avatar_id} belongs to a different ContOS user.",
            )

        existing_id = current.get("postiz_integration_id")
        if isinstance(existing_id, str) and existing_id.strip() == integration_id:
            return current

        owner = self.get_connection_by_integration_id(integration_id)
        if owner is not None:
            owner_avatar = owner.get("avatar_id")
            if owner_avatar is not None and str(owner_avatar) != str(avatar_id):
                raise PostizIntegrationClaimError(
                    "This LinkedIn integration is already linked to another ContOS avatar.",
                )
            # Legacy row (avatar_id NULL) or same avatar — still block other users.
            if str(owner.get("contos_user_id")) != str(contos_user_id):
                raise PostizIntegrationClaimError(
                    "This LinkedIn integration is already linked to another ContOS account.",
                )

        try:
            response = (
                self._client.table(_TABLE)
                .update({"postiz_integration_id": integration_id})
                .eq("avatar_id", str(avatar_id))
                .execute()
            )
        except APIError as error:
            if not _is_unique_violation(error):
                raise RepositoryError(
                    f"Failed to claim Postiz integration for avatar {avatar_id}: {error}",
                ) from error
            return self._resolve_claim_after_unique_conflict(
                contos_user_id=contos_user_id,
                avatar_id=avatar_id,
                integration_id=integration_id,
                cause=error,
            )

        rows = [] if response is None else (response.data or [])
        if not rows:
            return self._resolve_claim_after_unique_conflict(
                contos_user_id=contos_user_id,
                avatar_id=avatar_id,
                integration_id=integration_id,
                cause=None,
            )

        logger.info(
            "Claimed Postiz LinkedIn integration",
            extra={
                "contos_user_id": str(contos_user_id),
                "avatar_id": str(avatar_id),
                "postiz_integration_id": integration_id,
            },
        )
        return rows[0]

    def _resolve_claim_after_unique_conflict(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        integration_id: str,
        cause: BaseException | None,
    ) -> dict[str, Any]:
        owned = self.get_connection(avatar_id)
        if (
            owned is not None
            and isinstance(owned.get("postiz_integration_id"), str)
            and owned["postiz_integration_id"].strip() == integration_id
        ):
            return owned

        owner = self.get_connection_by_integration_id(integration_id)
        if (
            owner is not None
            and str(owner.get("avatar_id")) == str(avatar_id)
            and str(owner.get("contos_user_id")) == str(contos_user_id)
        ):
            return owner

        raise PostizIntegrationClaimError(
            "This LinkedIn integration is already linked to another ContOS avatar.",
        ) from cause

    def clear_integration_id(self, avatar_id: UUID) -> dict[str, Any]:
        """Clear LinkedIn integration id for one avatar; keep org token for reconnect."""
        current = self.get_connection(avatar_id)
        if current is None:
            raise RepositoryError(
                f"No Postiz connection exists for avatar {avatar_id}.",
            )

        response = (
            self._client.table(_TABLE)
            .update({"postiz_integration_id": None})
            .eq("avatar_id", str(avatar_id))
            .execute()
        )
        rows = [] if response is None else (response.data or [])
        if not rows:
            raise RepositoryError(
                f"Failed to clear Postiz integration id for avatar {avatar_id}.",
            )

        logger.info(
            "Cleared Postiz LinkedIn integration id",
            extra={"avatar_id": str(avatar_id)},
        )
        return rows[0]

    def delete_connection(self, avatar_id: UUID) -> None:
        response = (
            self._client.table(_TABLE)
            .delete()
            .eq("avatar_id", str(avatar_id))
            .execute()
        )
        if response is None:
            raise RepositoryError(
                f"Failed to delete Postiz connection for avatar {avatar_id}.",
            )
        logger.info(
            "Deleted Postiz connection",
            extra={"avatar_id": str(avatar_id)},
        )
