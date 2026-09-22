"""Avatar-scoped Postiz calendar posts and LinkedIn disconnect."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import UUID

from app.clients.postiz_client import PostizClient
from app.clients.postiz_repository import PostizRepository
from app.config import Settings
from app.errors import (
    PostizNotConnectedError,
    PostizPostNotFoundError,
    PostizServiceError,
    RepositoryError,
)
from app.services.postiz_oauth import PostizOAuthService, require_postiz_settings

logger = logging.getLogger(__name__)

PostType = Literal["now", "schedule", "draft", "update"]
PostStatusAction = Literal["draft", "schedule"]

# Wide range used only to locate a post by id for ownership checks (Postiz has no
# public GET /posts/:id). Calendar listing always uses the caller-supplied window.
_OWNERSHIP_START = "2000-01-01T00:00:00.000Z"
_OWNERSHIP_END = "2100-01-01T00:00:00.000Z"

_ISO_DATETIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?"
    r"(Z|[+-]\d{2}:\d{2})$",
)


@dataclass(frozen=True)
class CalendarPost:
    id: str
    content: str
    publish_date: str
    state: str
    group: str | None
    release_url: str | None
    integration_id: str
    integration_name: str | None


@dataclass(frozen=True)
class DisconnectResult:
    disconnected: bool
    warning: str


class PostizPostsService:
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        oauth: PostizOAuthService | None = None,
        client: PostizClient | None = None,
        repository: PostizRepository | None = None,
    ) -> None:
        self._settings = require_postiz_settings(settings)
        self._client = client or PostizClient(self._settings)
        self._repository = repository or PostizRepository(self._settings)
        self._oauth = oauth or PostizOAuthService(
            self._settings,
            client=self._client,
            repository=self._repository,
        )

    def list_posts(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        start_date: str,
        end_date: str,
    ) -> list[CalendarPost]:
        start = self._require_iso_datetime(start_date, field_name="start_date")
        end = self._require_iso_datetime(end_date, field_name="end_date")
        access_token, integration_id = self._require_connected_context(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )
        raw_posts = self._client.list_posts(
            access_token,
            start_date=start,
            end_date=end,
        )
        return [
            mapped
            for mapped in (self._map_post(item) for item in raw_posts)
            if mapped is not None and mapped.integration_id == integration_id
        ]

    def create_or_update_post(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        post_type: PostType,
        content: str,
        publish_date: str,
        post_id: str | None = None,
    ) -> Any:
        cleaned_content = content.strip()
        if not cleaned_content:
            raise PostizServiceError("Post content must not be empty.")

        if post_type == "update":
            if not post_id or not post_id.strip():
                raise PostizServiceError("post_id is required when type is update.")
        elif post_id is not None and post_id.strip():
            raise PostizServiceError("post_id is only allowed when type is update.")

        date_value = self._require_iso_datetime(publish_date, field_name="publish_date")
        access_token, integration_id = self._require_connected_context(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )

        value_entry: dict[str, Any] = {
            "content": cleaned_content,
            "image": [],
        }
        if post_type == "update":
            owned = self._require_owned_post(
                access_token=access_token,
                integration_id=integration_id,
                post_id=post_id.strip(),  # type: ignore[union-attr]
            )
            value_entry["id"] = owned.id

        payload = {
            "type": post_type,
            "shortLink": False,
            "date": date_value,
            "tags": [],
            "posts": [
                {
                    "integration": {"id": integration_id},
                    "value": [value_entry],
                    "settings": {"__type": "linkedin"},
                },
            ],
        }

        result = self._client.create_post(access_token, payload)
        logger.info(
            "Created or updated Postiz post",
            extra={
                "contos_user_id": str(contos_user_id),
                "avatar_id": str(avatar_id),
                "post_type": post_type,
                "post_id": post_id.strip() if post_id else None,
            },
        )
        return result

    def change_post_status(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        post_id: str,
        status: PostStatusAction,
    ) -> Any:
        if status not in {"draft", "schedule"}:
            raise PostizServiceError("status must be 'draft' or 'schedule'.")

        access_token, integration_id = self._require_connected_context(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )
        self._require_owned_post(
            access_token=access_token,
            integration_id=integration_id,
            post_id=post_id,
        )
        result = self._client.change_post_status(access_token, post_id, status)
        logger.info(
            "Changed Postiz post status",
            extra={
                "contos_user_id": str(contos_user_id),
                "avatar_id": str(avatar_id),
                "post_id": post_id.strip(),
                "status": status,
            },
        )
        return result

    def delete_post(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        post_id: str,
    ) -> Any:
        access_token, integration_id = self._require_connected_context(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )
        self._require_owned_post(
            access_token=access_token,
            integration_id=integration_id,
            post_id=post_id,
        )
        result = self._client.delete_post(access_token, post_id)
        logger.info(
            "Deleted Postiz post",
            extra={
                "contos_user_id": str(contos_user_id),
                "avatar_id": str(avatar_id),
                "post_id": post_id.strip(),
            },
        )
        return result

    def disconnect_linkedin(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
    ) -> DisconnectResult:
        connection = self._require_avatar_connection(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )
        integration_id = connection.get("postiz_integration_id")
        if not isinstance(integration_id, str) or not integration_id.strip():
            raise PostizNotConnectedError(
                "This avatar has no LinkedIn integration to disconnect.",
            )

        access_token = self._oauth.decrypt_access_token(
            connection["encrypted_access_token"],
        )
        self._client.delete_integration(access_token, integration_id.strip())
        self._repository.clear_integration_id(avatar_id)
        self._oauth.clear_avatar_caches(avatar_id)

        warning = (
            "LinkedIn was disconnected for this avatar only. Postiz removes scheduled "
            "and draft posts for that LinkedIn channel. Other ContOS avatars are "
            "unaffected. This does not log you out of LinkedIn globally."
        )
        logger.info(
            "Disconnected avatar LinkedIn integration",
            extra={
                "contos_user_id": str(contos_user_id),
                "avatar_id": str(avatar_id),
                "postiz_integration_id": integration_id.strip(),
            },
        )
        return DisconnectResult(disconnected=True, warning=warning)

    def _require_connected_context(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
    ) -> tuple[str, str]:
        connection = self._require_avatar_connection(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )
        integration_id = connection.get("postiz_integration_id")
        if not isinstance(integration_id, str) or not integration_id.strip():
            raise PostizNotConnectedError(
                "Connect LinkedIn for this avatar before managing calendar posts.",
            )
        access_token = self._oauth.decrypt_access_token(
            connection["encrypted_access_token"],
        )
        return access_token, integration_id.strip()

    def _require_avatar_connection(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
    ) -> dict[str, Any]:
        connection = self._repository.get_connection(avatar_id)
        if connection is None:
            raise PostizNotConnectedError(
                "No Postiz connection exists for this avatar. Connect LinkedIn first.",
            )
        if str(connection.get("contos_user_id")) != str(contos_user_id):
            raise RepositoryError(
                f"Postiz connection for avatar {avatar_id} belongs to a different ContOS user.",
            )
        return connection

    def _require_owned_post(
        self,
        *,
        access_token: str,
        integration_id: str,
        post_id: str,
    ) -> CalendarPost:
        cleaned = post_id.strip()
        if not cleaned:
            raise PostizServiceError("post_id is required.")

        raw_posts = self._client.list_posts(
            access_token,
            start_date=_OWNERSHIP_START,
            end_date=_OWNERSHIP_END,
        )
        for item in raw_posts:
            mapped = self._map_post(item)
            if mapped is None:
                continue
            if mapped.id == cleaned and mapped.integration_id == integration_id:
                return mapped

        raise PostizPostNotFoundError(
            "Post was not found for this avatar's LinkedIn channel.",
        )

    def _map_post(self, item: Any) -> CalendarPost | None:
        if not isinstance(item, dict):
            return None
        post_id = item.get("id")
        content = item.get("content")
        state = item.get("state")
        if not isinstance(post_id, str) or not post_id.strip():
            return None
        if not isinstance(content, str):
            return None
        if not isinstance(state, str) or not state.strip():
            return None

        publish_raw = item.get("publishDate")
        publish_date = self._normalize_publish_date(publish_raw)
        if publish_date is None:
            return None

        integration = item.get("integration")
        integration_id: str | None = None
        integration_name: str | None = None
        if isinstance(integration, dict):
            raw_id = integration.get("id")
            if isinstance(raw_id, str) and raw_id.strip():
                integration_id = raw_id.strip()
            raw_name = integration.get("name")
            if isinstance(raw_name, str) and raw_name.strip():
                integration_name = raw_name.strip()
        if integration_id is None:
            return None

        group = item.get("group")
        release_url = item.get("releaseURL")
        return CalendarPost(
            id=post_id.strip(),
            content=content,
            publish_date=publish_date,
            state=state.strip().upper(),
            group=group.strip() if isinstance(group, str) and group.strip() else None,
            release_url=(
                release_url.strip()
                if isinstance(release_url, str) and release_url.strip()
                else None
            ),
            integration_id=integration_id,
            integration_name=integration_name,
        )

    @staticmethod
    def _require_iso_datetime(value: str, *, field_name: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise PostizServiceError(f"{field_name} is required.")
        if not _ISO_DATETIME_RE.match(cleaned):
            raise PostizServiceError(
                f"{field_name} must be an ISO-8601 datetime with timezone "
                f"(Z or ±HH:MM), e.g. 2026-09-23T15:30:00+05:30. Got: {cleaned!r}",
            )
        # Reject values that look valid but are not parseable.
        try:
            normalized = cleaned.replace("Z", "+00:00")
            datetime.fromisoformat(normalized)
        except ValueError as error:
            raise PostizServiceError(
                f"{field_name} is not a valid ISO-8601 datetime: {cleaned!r}",
            ) from error
        return cleaned

    @staticmethod
    def _normalize_publish_date(value: Any) -> str | None:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            return value.isoformat().replace("+00:00", "Z")
        return None
