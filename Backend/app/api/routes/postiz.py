"""Postiz LinkedIn OAuth bridge endpoints for ContOS Calendar (avatar-scoped)."""

from __future__ import annotations

import logging
from typing import Any, Literal, NoReturn
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.api.deps import get_current_user_id
from app.clients.supabase_repo import SupabaseRepository
from app.config import get_settings
from app.errors import (
    ConfigurationError,
    PostizAuthorizationInvalidError,
    PostizIntegrationClaimError,
    PostizNotConnectedError,
    PostizPostNotFoundError,
    PostizServiceError,
    RepositoryError,
)
from app.services.postiz_oauth import PostizOAuthService
from app.services.postiz_posts import PostizPostsService

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


class ClaimIntegrationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    avatar_id: UUID
    integration_id: str = Field(min_length=1)


class CalendarPostResponse(BaseModel):
    id: str
    content: str
    publish_date: str
    state: str
    group: str | None = None
    release_url: str | None = None
    integration_id: str
    integration_name: str | None = None


class CalendarPostsResponse(BaseModel):
    posts: list[CalendarPostResponse]


class CreatePostRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    avatar_id: UUID
    type: Literal["now", "schedule", "draft", "update"]
    content: str = Field(min_length=1, max_length=3000)
    publish_date: str = Field(min_length=1)
    post_id: str | None = None

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("content must not be blank")
        return cleaned


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
    if isinstance(error, PostizServiceError):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
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
    user_id: UUID = Depends(get_current_user_id),
) -> ConnectResponse:
    try:
        _verify_avatar_owner(avatar_id, user_id)
        result = _get_service().start_connect(
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


@router.get("/status", response_model=StatusResponse)
def get_postiz_status(
    avatar_id: UUID = Query(...),
    user_id: UUID = Depends(get_current_user_id),
) -> StatusResponse:
    try:
        _verify_avatar_owner(avatar_id, user_id)
        status_result = _get_service().get_status(
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
    return StatusResponse(
        connected=status_result.connected,
        integration=integration,
        claim_candidates=[
            _integration_response(candidate)
            for candidate in status_result.claim_candidates
        ],
    )


@router.post("/claim", response_model=StatusResponse)
def claim_postiz_integration(
    body: ClaimIntegrationRequest,
    user_id: UUID = Depends(get_current_user_id),
) -> StatusResponse:
    try:
        _verify_avatar_owner(body.avatar_id, user_id)
        status_result = _get_service().claim_linkedin_integration(
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
        "Claimed Postiz LinkedIn integration via API",
        extra={
            "contos_user_id": str(user_id),
            "avatar_id": str(body.avatar_id),
            "postiz_integration_id": body.integration_id,
        },
    )
    integration = None
    if status_result.integration is not None:
        integration = _integration_response(status_result.integration)
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
            )
            for post in posts
        ],
    )


@router.post("/posts")
def create_postiz_post(
    body: CreatePostRequest,
    user_id: UUID = Depends(get_current_user_id),
) -> dict[str, Any]:
    try:
        _verify_avatar_owner(body.avatar_id, user_id)
        result = _get_posts_service().create_or_update_post(
            contos_user_id=user_id,
            avatar_id=body.avatar_id,
            post_type=body.type,
            content=body.content,
            publish_date=body.publish_date,
            post_id=body.post_id,
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
    user_id: UUID = Depends(get_current_user_id),
) -> DisconnectResponse:
    try:
        _verify_avatar_owner(avatar_id, user_id)
        result = _get_posts_service().disconnect_linkedin(
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
