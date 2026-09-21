"""Supabase persistence for ContOS ↔ Postiz organization connections."""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from supabase import Client, create_client

from app.config import Settings
from app.errors import ConfigurationError, RepositoryError

logger = logging.getLogger(__name__)

_TABLE = "postiz_connections"


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

    def get_connection(self, contos_user_id: UUID) -> dict[str, Any] | None:
        response = (
            self._client.table(_TABLE)
            .select(
                "id, contos_user_id, postiz_organization_id, encrypted_access_token, "
                "created_at, updated_at",
            )
            .eq("contos_user_id", str(contos_user_id))
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
        postiz_organization_id: str,
        encrypted_access_token: str,
    ) -> dict[str, Any]:
        if not postiz_organization_id.strip():
            raise RepositoryError("postiz_organization_id is required.")
        if not encrypted_access_token.strip():
            raise RepositoryError("encrypted_access_token is required.")

        payload = {
            "contos_user_id": str(contos_user_id),
            "postiz_organization_id": postiz_organization_id.strip(),
            "encrypted_access_token": encrypted_access_token,
        }
        response = (
            self._client.table(_TABLE)
            .upsert(payload, on_conflict="contos_user_id")
            .execute()
        )
        rows = [] if response is None else (response.data or [])
        if not rows:
            raise RepositoryError(
                f"Failed to upsert Postiz connection for user {contos_user_id}.",
            )

        logger.info(
            "Upserted Postiz connection",
            extra={
                "contos_user_id": str(contos_user_id),
                "postiz_organization_id": postiz_organization_id,
            },
        )
        return rows[0]

    def delete_connection(self, contos_user_id: UUID) -> None:
        response = (
            self._client.table(_TABLE)
            .delete()
            .eq("contos_user_id", str(contos_user_id))
            .execute()
        )
        if response is None:
            raise RepositoryError(
                f"Failed to delete Postiz connection for user {contos_user_id}.",
            )
        logger.info(
            "Deleted Postiz connection",
            extra={"contos_user_id": str(contos_user_id)},
        )
