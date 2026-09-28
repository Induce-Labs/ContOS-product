"""Postiz LinkedIn OAuth bridge endpoints for ContOS Calendar (avatar-scoped)."""

from __future__ import annotations

import logging
from typing import Any, Literal, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.api.deps import get_current_user_id
from app.clients.supabase_repo import SupabaseRepository
from app.config import get_settings
from app.errors import (
    ConfigurationError,
    PostizAuthorizationInvalidError,
    PostizBadRequestError,
    PostizIntegrationClaimError,
    PostizMediaOwnershipError,
    PostizNotConnectedError,
    PostizPostNotFoundError,
    PostizServiceError,
    RepositoryError,
)
from app.services.postiz_oauth import PostizOAuthService
from app.services.postiz_posts import MAX_POST_IMAGES, MediaRef, PostizPostsService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/postiz", tags=["postiz"])


class ConnectResponse(BaseModel):
    authorization_url: str
    flow: str


class IntegrationResponse(BaseModel):
    id: str
    name: str
    identifier: str
    picture: str | None = None


class StatusResponse(BaseModel):
    connected: bool
    integration: IntegrationResponse | None
    claim_candidates: list[IntegrationResponse] = Field(default_factory=list)


class XStatusResponse(BaseModel):
    platform: Literal["x"] = "x"
    connected: bool
    integration_id: str | None = None
    integration: IntegrationResponse | None = None
    claim_candidates: list[IntegrationResponse] = Field(default_factory=list)


class ClaimIntegrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    avatar_id: UUID
    integration_id: str = Field(min_length=1)
    platform: Literal["linkedin", "x"] = "linkedin"


class MediaItemResponse(BaseModel):
    id: str
    path: str
    alt: str | None = None
    thumbnail: str | None = None
    name: str | None = None
    original_name: str | None = None


class MediaItemRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    path: str = Field(min_length=1)
    alt: str | None = None
    thumbnail: str | None = None


class CalendarPostResponse(BaseModel):
    id: str
    content: str
    publish_date: str
    state: str
    group: str | None = None
    release_url: str | None = None
    integration_id: str
    integration_name: str | None = None
    images: list[MediaItemResponse] = Field(default_factory=list)


class CalendarPostsResponse(BaseModel):
    posts: list[CalendarPostResponse]


class XThreadEntryRequest(BaseModel):
    """One X thread entry. Content is kept as typed; later entries cannot carry media."""

    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1, max_length=4000)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content must not be blank")
        return value


class CreatePostRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    avatar_id: UUID
    type: Literal["now", "schedule", "draft", "update"]
    content: str = Field(min_length=1, max_length=4000)
    publish_date: str = Field(min_length=1)
    post_id: str | None = None
    images: list[MediaItemRequest] = Field(default_factory=list, max_length=MAX_POST_IMAGES)
    platform: Literal["linkedin", "x"] = "linkedin"
    posts: list[XThreadEntryRequest] | None = Field(default=None, min_length=1)

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content must not be blank")
        return value

    @model_validator(mode="after")
    def linkedin_content_stays_at_3000(self) -> "CreatePostRequest":
        if self.platform == "linkedin" and len(self.content.strip()) > 3000:
            raise ValueError("content must be at most 3000 characters")
        if self.platform == "linkedin" and self.posts is not None:
            raise ValueError("posts is only supported for X")
        if self.posts is not None and self.content != self.posts[0].content:
            raise ValueError("content must equal the first X thread entry")
        return self


class ChangePostStatusRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    avatar_id: UUID
    status: Literal["draft", "schedule"]


class DisconnectResponse(BaseModel):
    disconnected: bool
    warning: str


def _integration_response(integration: object) -> IntegrationResponse:
    return IntegrationResponse(
        id=getattr(integration, "id"),
        name=getattr(integration, "name"),
        identifier=getattr(integration, "identifier"),
        picture=getattr(integration, "picture", None),
    )


def _get_service() -> PostizOAuthService:
    return PostizOAuthService()


def _get_posts_service() -> PostizPostsService:
    return PostizPostsService()


def _verify_avatar_owner(avatar_id: UUID, user_id: UUID) -> None:
    SupabaseRepository(get_settings()).verify_avatar_owner(avatar_id, user_id)


def _raise_postiz_http(error: Exception) -> NoReturn:
    if isinstance(error, ConfigurationError):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
    if isinstance(error, PostizAuthorizationInvalidError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(error),
        ) from error
    if isinstance(error, PostizIntegrationClaimError):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error
    if isinstance(error, PostizNotConnectedError):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(error),
        ) from error
    if isinstance(error, PostizPostNotFoundError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error
    if isinstance(error, PostizMediaOwnershipError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(error),
        ) from error
    if isinstance(error, PostizBadRequestError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
    if isinstance(error, PostizServiceError):
        upstream = getattr(error, "status_code", None)
        http_status = (
            upstream
            if isinstance(upstream, int) and upstream in {502, 503, 504}
            else status.HTTP_502_BAD_GATEWAY
        )
        raise HTTPException(
            status_code=http_status,
            detail=str(error),
        ) from error
    if isinstance(error, RepositoryError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND
            if "not found" in str(error).lower() or "permission" in str(error).lower()
            else status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
    raise error


@router.get("/connect", response_model=ConnectResponse)
def start_postiz_connect(
    avatar_id: UUID = Query(...),
    platform: Literal["linkedin", "x"] = Query("linkedin"),
    user_id: UUID = Depends(get_current_user_id),
) -> ConnectResponse:
    try:
        _verify_avatar_owner(avatar_id, user_id)
        service = _get_service()
        if platform == "x":
            result = service.start_x_connect(
                contos_user_id=user_id,
                avatar_id=avatar_id,
            )
        else:
            result = service.start_connect(
                contos_user_id=user_id,
                avatar_id=avatar_id,
            )
    except (
        ConfigurationError,
        PostizAuthorizationInvalidError,
        PostizServiceError,
        RepositoryError,
    ) as error:
        _raise_postiz_http(error)

    logger.info(
        "Started Postiz connect flow",
        extra={
            "contos_user_id": str(user_id),
            "avatar_id": str(avatar_id),
            "flow": result.flow,
        },
    )
    return ConnectResponse(
        authorization_url=result.authorization_url,
        flow=result.flow,
    )


@router.post("/oauth/callback", status_code=status.HTTP_410_GONE)
def complete_postiz_oauth_callback(
    user_id: UUID = Depends(get_current_user_id),
) -> None:
    """Org-consent OAuth is replaced by Approach B provisioning."""
    logger.info(
        "Rejected deprecated Postiz org-consent callback",
        extra={"contos_user_id": str(user_id)},
    )
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail=(
            "Postiz organization OAuth consent is no longer used. "
            "Connect LinkedIn from Calendar for the active avatar."
        ),
    )


@router.get("/status", response_model=StatusResponse | XStatusResponse)
def get_postiz_status(
    avatar_id: UUID = Query(...),
    platform: Literal["linkedin", "x"] = Query("linkedin"),
    user_id: UUID = Depends(get_current_user_id),
) -> StatusResponse | XStatusResponse:
    try:
        _verify_avatar_owner(avatar_id, user_id)
        service = _get_service()
        if platform == "x":
            status_result = service.get_x_status(
                contos_user_id=user_id,
                avatar_id=avatar_id,
            )
        else:
            status_result = service.get_status(
                contos_user_id=user_id,
                avatar_id=avatar_id,
            )
    except (
        ConfigurationError,
        PostizAuthorizationInvalidError,
        PostizIntegrationClaimError,
        PostizServiceError,
        RepositoryError,
    ) as error:
        _raise_postiz_http(error)

    integration = None
    if status_result.integration is not None:
        integration = _integration_response(status_result.integration)
    candidates = [
        _integration_response(candidate) for candidate in status_result.claim_candidates
    ]
    if platform == "x":
        return XStatusResponse(
            platform="x",
            connected=status_result.connected,
            integration_id=integration.id if integration is not None else None,
            integration=integration,
            claim_candidates=candidates,
        )
    return StatusResponse(
        connected=status_result.connected,
        integration=integration,
        claim_candidates=candidates,
    )


@router.post("/claim", response_model=StatusResponse | XStatusResponse)
def claim_postiz_integration(
    body: ClaimIntegrationRequest,
    user_id: UUID = Depends(get_current_user_id),
) -> StatusResponse | XStatusResponse:
    try:
        _verify_avatar_owner(body.avatar_id, user_id)
        service = _get_service()
        if body.platform == "x":
            status_result = service.claim_x_integration(
                contos_user_id=user_id,
                avatar_id=body.avatar_id,
                integration_id=body.integration_id,
            )
        else:
            status_result = service.claim_linkedin_integration(
                contos_user_id=user_id,
                avatar_id=body.avatar_id,
                integration_id=body.integration_id,
            )
    except (
        ConfigurationError,
        PostizAuthorizationInvalidError,
        PostizIntegrationClaimError,
        PostizServiceError,
        RepositoryError,
    ) as error:
        _raise_postiz_http(error)

    logger.info(
        "Claimed Postiz integration via API",
        extra={
            "contos_user_id": str(user_id),
            "avatar_id": str(body.avatar_id),
            "platform": body.platform,
            "integration_id": body.integration_id,
        },
    )
    integration = None
    if status_result.integration is not None:
        integration = _integration_response(status_result.integration)
    if body.platform == "x":
        return XStatusResponse(
            platform="x",
            connected=status_result.connected,
            integration_id=integration.id if integration is not None else None,
            integration=integration,
            claim_candidates=[],
        )
    return StatusResponse(
        connected=status_result.connected,
        integration=integration,
        claim_candidates=[],
    )


@router.get("/posts", response_model=CalendarPostsResponse)
def list_postiz_posts(
    avatar_id: UUID = Query(...),
    start_date: str = Query(...),
    end_date: str = Query(...),
    user_id: UUID = Depends(get_current_user_id),
) -> CalendarPostsResponse:
    try:
        _verify_avatar_owner(avatar_id, user_id)
        posts = _get_posts_service().list_posts(
            contos_user_id=user_id,
            avatar_id=avatar_id,
            start_date=start_date,
            end_date=end_date,
        )
    except (
        ConfigurationError,
        PostizAuthorizationInvalidError,
        PostizNotConnectedError,
        PostizServiceError,
        RepositoryError,
    ) as error:
        _raise_postiz_http(error)

    return CalendarPostsResponse(
        posts=[
            CalendarPostResponse(
                id=post.id,
                content=post.content,
                publish_date=post.publish_date,
                state=post.state,
                group=post.group,
                release_url=post.release_url,
                integration_id=post.integration_id,
                integration_name=post.integration_name,
                images=[
                    MediaItemResponse(
                        id=image.id,
                        path=image.path,
                        alt=image.alt,
                        thumbnail=image.thumbnail,
                        name=image.name,
                        original_name=image.original_name,
                    )
                    for image in post.images
                ],
            )
            for post in posts
        ],
    )


@router.post("/upload", response_model=MediaItemResponse)
async def upload_postiz_media(
    avatar_id: UUID = Query(...),
    file: UploadFile = File(...),
    user_id: UUID = Depends(get_current_user_id),
) -> MediaItemResponse:
    try:
        _verify_avatar_owner(avatar_id, user_id)
        content = await file.read()
        media = _get_posts_service().upload_media(
            contos_user_id=user_id,
            avatar_id=avatar_id,
            filename=file.filename or "upload",
            content=content,
            content_type=file.content_type or "application/octet-stream",
        )
    except (
        ConfigurationError,
        PostizAuthorizationInvalidError,
        PostizBadRequestError,
        PostizNotConnectedError,
        PostizServiceError,
        RepositoryError,
    ) as error:
        _raise_postiz_http(error)

    # ContOS always returns 200 + snake_case MediaItemResponse to the browser.
    # Postiz itself often replies 201 with camelCase originalName — already mapped.
    logger.info(
        "ContOS upload response ready for frontend",
        extra={
            "avatar_id": str(avatar_id),
            "media_id": media.id,
            "has_path": bool(media.path),
            "has_name": bool(media.name),
            "has_original_name": bool(media.original_name),
            "contos_http_status": 200,
        },
    )
    return MediaItemResponse(
        id=media.id,
        path=media.path,
        alt=media.alt,
        thumbnail=media.thumbnail,
        name=media.name,
        original_name=media.original_name,
    )


@router.post("/posts")
def create_postiz_post(
    body: CreatePostRequest,
    user_id: UUID = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        _verify_avatar_owner(body.avatar_id, user_id)
        images = [
            MediaRef(
                id=item.id,
                path=item.path,
                alt=item.alt,
                thumbnail=item.thumbnail,
            )
            for item in body.images
        ]
        posts = _get_posts_service()
        if body.platform == "x":
            result = posts.create_x_post(
                contos_user_id=user_id,
                avatar_id=body.avatar_id,
                post_type=body.type,
                content=body.content,
                publish_date=body.publish_date,
                post_id=body.post_id,
                images=images,
                thread=[entry.content for entry in body.posts] if body.posts is not None else None,
            )
        else:
            result = posts.create_or_update_post(
                contos_user_id=user_id,
                avatar_id=body.avatar_id,
                post_type=body.type,
                content=body.content,
                publish_date=body.publish_date,
                post_id=body.post_id,
                images=images,
            )
    except (
        ConfigurationError,
        PostizAuthorizationInvalidError,
        PostizBadRequestError,
        PostizMediaOwnershipError,
        PostizNotConnectedError,
        PostizPostNotFoundError,
        PostizServiceError,
        RepositoryError,
    ) as error:
        _raise_postiz_http(error)

    return {"result": result}


@router.put("/posts/{post_id}/status")
def change_postiz_post_status(
    post_id: str,
    body: ChangePostStatusRequest,
    user_id: UUID = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        _verify_avatar_owner(body.avatar_id, user_id)
        result = _get_posts_service().change_post_status(
            contos_user_id=user_id,
            avatar_id=body.avatar_id,
            post_id=post_id,
            status=body.status,
        )
    except (
        ConfigurationError,
        PostizAuthorizationInvalidError,
        PostizNotConnectedError,
        PostizPostNotFoundError,
        PostizServiceError,
        RepositoryError,
    ) as error:
        _raise_postiz_http(error)

    return {"result": result}


@router.delete("/posts/{post_id}")
def delete_postiz_post(
    post_id: str,
    avatar_id: UUID = Query(...),
    user_id: UUID = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        _verify_avatar_owner(avatar_id, user_id)
        result = _get_posts_service().delete_post(
            contos_user_id=user_id,
            avatar_id=avatar_id,
            post_id=post_id,
        )
    except (
        ConfigurationError,
        PostizAuthorizationInvalidError,
        PostizNotConnectedError,
        PostizPostNotFoundError,
        PostizServiceError,
        RepositoryError,
    ) as error:
        _raise_postiz_http(error)

    return {"result": result}


@router.delete("/integration", response_model=DisconnectResponse)
def disconnect_postiz_integration(
    avatar_id: UUID = Query(...),
    platform: Literal["linkedin", "x"] = Query("linkedin"),
    user_id: UUID = Depends(get_current_user_id),
) -> DisconnectResponse:
    try:
        _verify_avatar_owner(avatar_id, user_id)
        posts = _get_posts_service()
        if platform == "x":
            result = posts.disconnect_x(
                contos_user_id=user_id,
                avatar_id=avatar_id,
            )
        else:
            result = posts.disconnect_linkedin(
                contos_user_id=user_id,
                avatar_id=avatar_id,
            )
    except (
        ConfigurationError,
        PostizAuthorizationInvalidError,
        PostizNotConnectedError,
        PostizServiceError,
        RepositoryError,
    ) as error:
        _raise_postiz_http(error)

    return DisconnectResponse(
        disconnected=result.disconnected,
        warning=result.warning,
    )
