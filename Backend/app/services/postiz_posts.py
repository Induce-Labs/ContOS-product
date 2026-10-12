"""Avatar-scoped Postiz calendar posts and LinkedIn disconnect."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Sequence
from uuid import UUID

from app.clients.postiz_client import PostizClient
from app.clients.postiz_repository import PostizRepository
from app.config import Settings
from app.errors import (
    PostizBadRequestError,
    PostizMediaOwnershipError,
    PostizNotConnectedError,
    PostizPostNotFoundError,
    PostizServiceError,
    RepositoryError,
)
from app.services.postiz_consistency import (
    ConsistencyMonth,
    aggregate_published_posts,
    empty_consistency,
    local_month_bounds,
    month_key,
    require_month,
    require_timezone,
)
from app.services.postiz_oauth import PostizOAuthService, require_postiz_settings

logger = logging.getLogger(__name__)


def _clean_id(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None

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

MAX_POST_IMAGES = 10
MAX_X_POST_IMAGES = 4
_IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp"})
_VIDEO_MIME = "video/mp4"
_VIDEO_EXTENSION = ".mp4"
_ALLOWED_MEDIA_EXTENSIONS = _IMAGE_EXTENSIONS | {_VIDEO_EXTENSION}
_ALLOWED_UPLOAD_MIME = frozenset(
    {
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "image/avif",
        "image/bmp",
        "image/tiff",
        _VIDEO_MIME,
    },
)
_MAX_IMAGE_BYTES = 10 * 1024 * 1024
_MAX_VIDEO_BYTES = 1024 * 1024 * 1024


def _path_extension(path: str) -> str:
    cleaned = path.strip().split("?", 1)[0].rsplit(".", 1)
    if len(cleaned) < 2:
        return ""
    return f".{cleaned[-1].lower()}"


def _validate_upload_size(mime: str, size_bytes: int) -> None:
    """Enforce ContOS size limits from declared MIME (no byte sniffing)."""
    if mime == _VIDEO_MIME:
        if size_bytes > _MAX_VIDEO_BYTES:
            raise PostizBadRequestError(
                f"Video exceeds the maximum size of {_MAX_VIDEO_BYTES} bytes.",
            )
        return
    if mime.startswith("image/"):
        if size_bytes > _MAX_IMAGE_BYTES:
            raise PostizBadRequestError(
                f"Image exceeds the maximum size of {_MAX_IMAGE_BYTES} bytes.",
            )
        return
    raise PostizBadRequestError(f"Unsupported upload type {mime!r}.")


def _validate_upload_mime_and_extension(*, mime: str, filename: str) -> None:
    """ContOS checks declared MIME + filename extension only; Postiz sniffs content."""
    extension = _path_extension(filename)
    if mime == _VIDEO_MIME:
        if extension != _VIDEO_EXTENSION:
            raise PostizBadRequestError(
                f"video/mp4 uploads require a {_VIDEO_EXTENSION} filename. Got: {filename!r}.",
            )
        return
    if mime.startswith("image/") and mime in _ALLOWED_UPLOAD_MIME:
        if extension == _VIDEO_EXTENSION:
            raise PostizBadRequestError(
                f"Image upload MIME {mime!r} cannot use a {_VIDEO_EXTENSION} filename.",
            )
        return
    raise PostizBadRequestError(
        f"Unsupported upload type {mime!r}. "
        "Allowed: JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF, and video/mp4.",
    )


@dataclass(frozen=True)
class MediaRef:
    id: str
    path: str
    alt: str | None = None
    thumbnail: str | None = None
    name: str | None = None
    original_name: str | None = None


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
    images: list[MediaRef] = field(default_factory=list)


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
        access_token, channel_ids = self._require_any_channel_context(
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
            if mapped is not None and mapped.integration_id in channel_ids
        ]

    def monthly_consistency(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        month: str,
        timezone_name: str,
        now: datetime | None = None,
    ) -> ConsistencyMonth:
        """One Postiz list for the local month, then avatar LinkedIn/X day buckets."""
        tz = require_timezone(timezone_name)
        year, month_number = require_month(month)
        if now is None:
            clock = datetime.now(tz)
        else:
            if now.tzinfo is None:
                raise PostizBadRequestError(
                    "Consistency clock must include a timezone offset.",
                )
            clock = now.astimezone(tz)
        today = clock.date()
        canonical_month = f"{year:04d}-{month_number:02d}"
        if canonical_month > month_key(today):
            raise PostizBadRequestError(
                f"month {canonical_month} is in the future for timezone {tz.key}. "
                f"Current month is {month_key(today)}.",
            )

        try:
            connection = self._require_avatar_connection(
                contos_user_id=contos_user_id,
                avatar_id=avatar_id,
            )
        except PostizNotConnectedError:
            return empty_consistency(
                avatar_id=str(avatar_id),
                timezone=tz.key,
                month=canonical_month,
                today=today,
                connected=False,
            )

        linkedin_id = _clean_id(connection.get("postiz_integration_id"))
        x_id = _clean_id(connection.get("postiz_x_integration_id"))
        if linkedin_id is None and x_id is None:
            return empty_consistency(
                avatar_id=str(avatar_id),
                timezone=tz.key,
                month=canonical_month,
                today=today,
                connected=False,
            )

        start, end, _last_day = local_month_bounds(year, month_number, tz)
        query_start = start.isoformat()
        query_end = end.isoformat()
        access_token = self._oauth.decrypt_access_token(connection["encrypted_access_token"])
        raw_posts = self._client.list_posts(
            access_token,
            start_date=query_start,
            end_date=query_end,
        )
        result = aggregate_published_posts(
            raw_posts,
            avatar_id=str(avatar_id),
            timezone_name=tz.key,
            tz=tz,
            year=year,
            month=month_number,
            today=today,
            linkedin_id=linkedin_id,
            x_id=x_id,
            query_start=query_start,
            query_end=query_end,
        )
        logger.info(
            "Computed monthly posting consistency",
            extra={
                "avatar_id": str(avatar_id),
                "month": result.month,
                "timezone": result.timezone,
                "connected": result.connected,
                "posted_days": result.posted_days,
                "total_published_posts": result.total_published_posts,
            },
        )
        return result

    def upload_media(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> MediaRef:
        mime = (content_type or "").strip().lower() or "application/octet-stream"
        if mime not in _ALLOWED_UPLOAD_MIME:
            raise PostizBadRequestError(
                f"Unsupported upload type {mime!r}. "
                "Allowed: JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF, and video/mp4.",
            )
        if not content:
            raise PostizBadRequestError("Uploaded file must not be empty.")
        _validate_upload_mime_and_extension(mime=mime, filename=filename or "upload")
        _validate_upload_size(mime, len(content))

        access_token, _channel_ids = self._require_any_channel_context(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )
        logger.info(
            "Avatar media upload forwarding to Postiz",
            extra={
                "contos_user_id": str(contos_user_id),
                "avatar_id": str(avatar_id),
                "upload_filename": filename or "upload",
                "content_type": mime,
                "size_bytes": len(content),
            },
        )
        raw = self._client.upload_file(
            access_token,
            filename=filename or "upload",
            content=content,
            content_type=mime,
        )
        media = self._parse_media_ref(raw, require_name=False)
        if media is None:
            raise PostizServiceError("Postiz upload returned an incomplete media object.")
        logger.info(
            "Uploaded Postiz media for avatar",
            extra={
                "contos_user_id": str(contos_user_id),
                "avatar_id": str(avatar_id),
                "media_id": media.id,
                "upload_filename": filename or "upload",
                "content_type": mime,
                "size_bytes": len(content),
            },
        )
        return media

    def create_or_update_post(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        post_type: PostType,
        content: str,
        publish_date: str,
        post_id: str | None = None,
        images: Sequence[MediaRef] | None = None,
    ) -> Any:
        cleaned_content = content.strip()
        if not cleaned_content:
            raise PostizBadRequestError("Post content must not be empty.")

        if post_type == "update":
            if not post_id or not post_id.strip():
                raise PostizBadRequestError("post_id is required when type is update.")
        elif post_id is not None and post_id.strip():
            raise PostizBadRequestError("post_id is only allowed when type is update.")

        date_value = self._require_iso_datetime(publish_date, field_name="publish_date")
        access_token, integration_id = self._require_connected_context(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )

        normalized_images = self._normalize_images(images)
        self._assert_media_owned_by_avatar_org(
            access_token=access_token,
            images=normalized_images,
        )

        value_entry: dict[str, Any] = {
            "content": cleaned_content,
            # Complete final array — empty clears media on update.
            "image": [
                {
                    "id": item.id,
                    "path": item.path,
                    **({"alt": item.alt} if item.alt else {}),
                    **({"thumbnail": item.thumbnail} if item.thumbnail else {}),
                }
                for item in normalized_images
            ],
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
                    # Native LinkedIn multi-image; do not enable PDF carousel.
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
                "image_count": len(normalized_images),
            },
        )
        return result

    def create_x_post(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
        post_type: PostType,
        content: str,
        publish_date: str,
        post_id: str | None = None,
        images: Sequence[MediaRef] | None = None,
        thread: Sequence[str] | None = None,
    ) -> Any:
        """Create an X post through Postiz. Does not use the LinkedIn integration id.

        ``thread`` is the ordered entry list. When omitted, ``content`` is the only
        entry. Original text is sent to Postiz; emptiness and length use the trimmed text.
        Media is attached only to the first entry.
        """
        updating = post_type == "update"
        if updating:
            if not post_id or not post_id.strip():
                raise PostizBadRequestError("post_id is required when type is update.")
            if thread is not None and (
                len(thread) != 1 or thread[0] != content
            ):
                raise PostizBadRequestError(
                    "An X update edits the first post only. "
                    "content must equal that post, with no extra replies.",
                )
        elif post_id is not None and post_id.strip():
            raise PostizBadRequestError("post_id is only allowed when type is update.")

        entries = [content] if updating else (list(thread) if thread is not None else [content])
        if not entries:
            raise PostizBadRequestError("X post must include at least one entry.")
        if thread is not None and content != entries[0]:
            raise PostizBadRequestError(
                "content must equal the first X thread entry.",
            )
        for index, entry in enumerate(entries):
            if not isinstance(entry, str) or not entry.strip():
                raise PostizBadRequestError(
                    f"X thread entry {index + 1} must not be empty.",
                )

        date_value = self._require_iso_datetime(publish_date, field_name="publish_date")
        access_token, integration_id = self._require_x_context(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )
        normalized_images = self._normalize_images(
            images,
            max_images=MAX_X_POST_IMAGES,
        )
        self._assert_media_owned_by_avatar_org(
            access_token=access_token,
            images=normalized_images,
        )

        owned_id: str | None = None
        if updating:
            owned = self._require_owned_post(
                access_token=access_token,
                integration_id=integration_id,
                post_id=post_id.strip(),  # type: ignore[union-attr]
                channel_label="X",
            )
            if owned.state not in {"DRAFT", "QUEUE"}:
                raise PostizBadRequestError(
                    "Only draft and scheduled X posts can be edited. "
                    f"This post is {owned.state}.",
                )
            owned_id = owned.id

        settings_payload = self._client.get_integration_settings(
            access_token,
            integration_id,
        )
        limit = self._oauth.x_character_limit(settings_payload)
        for index, entry in enumerate(entries):
            trimmed_length = len(entry.strip())
            if trimmed_length > limit:
                raise PostizBadRequestError(
                    f"X thread entry {index + 1} must be 1–{limit} characters. "
                    f"Postiz reported a limit of {limit} characters for this integration. "
                    f"Got {trimmed_length}.",
                )

        image_payload = [
            {
                "id": item.id,
                "path": item.path,
                **({"alt": item.alt} if item.alt else {}),
                **({"thumbnail": item.thumbnail} if item.thumbnail else {}),
            }
            for item in normalized_images
        ]
        value = [
            {
                "content": entry,
                "image": image_payload if index == 0 else [],
                **({"id": owned_id} if index == 0 and owned_id else {}),
            }
            for index, entry in enumerate(entries)
        ]
        payload = {
            "type": post_type,
            "shortLink": False,
            "date": date_value,
            "tags": [],
            "posts": [
                {
                    "integration": {"id": integration_id},
                    "value": value,
                    "settings": {
                        "__type": "x",
                        "who_can_reply_post": "everyone",
                    },
                },
            ],
        }
        result = self._client.create_post(access_token, payload)
        logger.info(
            "Created Postiz X post",
            extra={
                "contos_user_id": str(contos_user_id),
                "avatar_id": str(avatar_id),
                "post_type": post_type,
                "postiz_x_integration_id": integration_id,
                "image_count": len(normalized_images),
                "thread_entry_count": len(entries),
                "content_length": len(entries[0].strip()),
                "reported_max_length": limit,
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
            raise PostizBadRequestError("status must be 'draft' or 'schedule'.")

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
        connection = self._require_avatar_connection(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )
        channel_ids = self._stored_channel_ids(connection)
        if not channel_ids:
            raise PostizNotConnectedError(
                "Connect LinkedIn or X for this avatar before deleting posts.",
            )
        access_token = self._oauth.decrypt_access_token(
            connection["encrypted_access_token"],
        )
        owned = self._require_owned_post_on_channels(
            access_token=access_token,
            channel_ids=channel_ids,
            post_id=post_id,
        )
        x_integration_id = connection.get("postiz_x_integration_id")
        is_x_post = (
            isinstance(x_integration_id, str)
            and x_integration_id.strip()
            and owned.integration_id == x_integration_id.strip()
        )
        if is_x_post and owned.state not in {"DRAFT", "QUEUE"}:
            raise PostizBadRequestError(
                "Only draft and scheduled X posts can be deleted. "
                f"This post is {owned.state}.",
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

    def disconnect_x(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
    ) -> DisconnectResult:
        """Disconnect this avatar's X integration only. LinkedIn id is left unchanged."""
        connection = self._require_avatar_connection(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )
        integration_id = connection.get("postiz_x_integration_id")
        if not isinstance(integration_id, str) or not integration_id.strip():
            raise PostizNotConnectedError(
                "This avatar has no X integration to disconnect.",
            )

        access_token = self._oauth.decrypt_access_token(
            connection["encrypted_access_token"],
        )
        self._client.delete_integration(access_token, integration_id.strip())
        self._repository.clear_x_integration_id(avatar_id)
        self._oauth.clear_x_caches(avatar_id)

        warning = (
            "X was disconnected for this avatar only. The Postiz organization and "
            "LinkedIn integration for this avatar were not removed."
        )
        logger.info(
            "Disconnected avatar X integration",
            extra={
                "contos_user_id": str(contos_user_id),
                "avatar_id": str(avatar_id),
                "postiz_x_integration_id": integration_id.strip(),
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

    def _stored_channel_ids(self, connection: dict[str, Any]) -> set[str]:
        """LinkedIn and X ids on this avatar row only. Blank values are ignored."""
        ids: set[str] = set()
        for key in ("postiz_integration_id", "postiz_x_integration_id"):
            value = connection.get(key)
            if isinstance(value, str) and value.strip():
                ids.add(value.strip())
        return ids

    def _require_any_channel_context(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
    ) -> tuple[str, set[str]]:
        """Org token plus this avatar's LinkedIn and/or X ids. Neither id means not connected."""
        connection = self._require_avatar_connection(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )
        channel_ids = self._stored_channel_ids(connection)
        if not channel_ids:
            raise PostizNotConnectedError(
                "Connect LinkedIn for this avatar before managing calendar posts.",
            )
        access_token = self._oauth.decrypt_access_token(
            connection["encrypted_access_token"],
        )
        return access_token, channel_ids

    def _require_x_context(
        self,
        *,
        contos_user_id: UUID,
        avatar_id: UUID,
    ) -> tuple[str, str]:
        connection = self._require_avatar_connection(
            contos_user_id=contos_user_id,
            avatar_id=avatar_id,
        )
        integration_id = connection.get("postiz_x_integration_id")
        if not isinstance(integration_id, str) or not integration_id.strip():
            raise PostizNotConnectedError(
                "Connect X for this avatar before creating X posts.",
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
        channel_label: str = "LinkedIn",
    ) -> CalendarPost:
        cleaned = post_id.strip()
        if not cleaned:
            raise PostizBadRequestError("post_id is required.")

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
            f"Post was not found for this avatar's {channel_label} channel.",
        )

    def _require_owned_post_on_channels(
        self,
        *,
        access_token: str,
        channel_ids: set[str],
        post_id: str,
    ) -> CalendarPost:
        cleaned = post_id.strip()
        if not cleaned:
            raise PostizBadRequestError("post_id is required.")
        if not channel_ids:
            raise PostizNotConnectedError(
                "Connect LinkedIn or X for this avatar before deleting posts.",
            )

        raw_posts = self._client.list_posts(
            access_token,
            start_date=_OWNERSHIP_START,
            end_date=_OWNERSHIP_END,
        )
        for item in raw_posts:
            mapped = self._map_post(item)
            if mapped is None:
                continue
            if mapped.id == cleaned and mapped.integration_id in channel_ids:
                return mapped

        raise PostizPostNotFoundError(
            "Post was not found for this avatar's LinkedIn or X channel.",
        )

    def _normalize_images(
        self,
        images: Sequence[MediaRef] | None,
        *,
        max_images: int = MAX_POST_IMAGES,
    ) -> list[MediaRef]:
        if images is None:
            return []
        if len(images) > max_images:
            raise PostizBadRequestError(
                f"A post may include at most {max_images} images.",
            )
        normalized: list[MediaRef] = []
        video_count = 0
        image_count = 0
        for index, item in enumerate(images):
            media_id = item.id.strip() if isinstance(item.id, str) else ""
            path = item.path.strip() if isinstance(item.path, str) else ""
            if not media_id or not path:
                raise PostizBadRequestError(
                    f"images[{index}] requires non-empty id and path.",
                )
            extension = self._path_extension(path)
            if extension not in _ALLOWED_MEDIA_EXTENSIONS:
                raise PostizBadRequestError(
                    f"images[{index}] path must end with an allowed media extension "
                    f"({', '.join(sorted(_ALLOWED_MEDIA_EXTENSIONS))}). Got: {path!r}",
                )
            if extension == _VIDEO_EXTENSION:
                video_count += 1
            else:
                image_count += 1
            alt = item.alt.strip() if isinstance(item.alt, str) and item.alt.strip() else None
            thumbnail = (
                item.thumbnail.strip()
                if isinstance(item.thumbnail, str) and item.thumbnail.strip()
                else None
            )
            normalized.append(
                MediaRef(id=media_id, path=path, alt=alt, thumbnail=thumbnail),
            )

        if video_count > 1:
            raise PostizBadRequestError(
                "A post may include at most one video attachment.",
            )
        if video_count == 1 and image_count > 0:
            raise PostizBadRequestError(
                "A post cannot combine video and image attachments.",
            )
        return normalized

    def _assert_media_owned_by_avatar_org(
        self,
        *,
        access_token: str,
        images: Sequence[MediaRef],
    ) -> None:
        for item in images:
            try:
                remote = self._client.get_media(access_token, item.id)
            except PostizServiceError as error:
                message = str(error)
                if "404" in message or "not found" in message.lower():
                    raise PostizMediaOwnershipError(
                        f"Media {item.id!r} was not found in this avatar's Postiz organization.",
                    ) from error
                raise
            remote_id = remote.get("id") if isinstance(remote, dict) else None
            remote_path = remote.get("path") if isinstance(remote, dict) else None
            if not isinstance(remote_id, str) or remote_id.strip() != item.id:
                raise PostizMediaOwnershipError(
                    f"Media {item.id!r} was not found in this avatar's Postiz organization.",
                )
            if not isinstance(remote_path, str) or remote_path.strip() != item.path:
                raise PostizMediaOwnershipError(
                    f"Media {item.id!r} path does not match this avatar's uploaded media.",
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
        images = self._parse_images_field(item.get("image"))
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
            images=images,
        )

    @classmethod
    def _parse_images_field(cls, raw: Any) -> list[MediaRef]:
        if raw is None:
            return []
        parsed: Any = raw
        if isinstance(raw, str):
            cleaned = raw.strip()
            if not cleaned:
                return []
            try:
                parsed = json.loads(cleaned)
            except ValueError:
                return []
        if not isinstance(parsed, list):
            return []
        images: list[MediaRef] = []
        for entry in parsed:
            media = cls._parse_media_ref(entry, require_name=False)
            if media is not None:
                images.append(media)
        return images

    @staticmethod
    def _parse_media_ref(raw: Any, *, require_name: bool) -> MediaRef | None:
        if not isinstance(raw, dict):
            return None
        media_id = raw.get("id")
        path = raw.get("path")
        if not isinstance(media_id, str) or not media_id.strip():
            return None
        if not isinstance(path, str) or not path.strip():
            return None
        name = raw.get("name")
        original_name = raw.get("originalName")
        if not isinstance(original_name, str):
            original_name = raw.get("original_name")
        if require_name and not isinstance(name, str):
            return None
        alt = raw.get("alt")
        thumbnail = raw.get("thumbnail")
        return MediaRef(
            id=media_id.strip(),
            path=path.strip(),
            alt=alt.strip() if isinstance(alt, str) and alt.strip() else None,
            thumbnail=(
                thumbnail.strip()
                if isinstance(thumbnail, str) and thumbnail.strip()
                else None
            ),
            name=name.strip() if isinstance(name, str) and name.strip() else None,
            original_name=(
                original_name.strip()
                if isinstance(original_name, str) and original_name.strip()
                else None
            ),
        )

    @staticmethod
    def _path_extension(path: str) -> str:
        return _path_extension(path)

    @staticmethod
    def _require_iso_datetime(value: str, *, field_name: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise PostizBadRequestError(f"{field_name} is required.")
        if not _ISO_DATETIME_RE.match(cleaned):
            raise PostizBadRequestError(
                f"{field_name} must be an ISO-8601 datetime with timezone "
                f"(Z or ±HH:MM), e.g. 2026-09-23T15:30:00+05:30. Got: {cleaned!r}",
            )
        try:
            normalized = cleaned.replace("Z", "+00:00")
            datetime.fromisoformat(normalized)
        except ValueError as error:
            raise PostizBadRequestError(
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
            return value.isoformat()
        return None
