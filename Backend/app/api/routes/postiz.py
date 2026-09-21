"""Postiz LinkedIn OAuth bridge endpoints for ContOS Calendar."""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_current_user_id
from app.errors import (
    ConfigurationError,
    PostizAuthorizationInvalidError,
    PostizOAuthStateError,
    PostizServiceError,
    RepositoryError,
)
from app.services.postiz_oauth import PostizOAuthService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/postiz", tags=["postiz"])


class ConnectResponse(BaseModel):
    authorization_url: str
    flow: str


class OAuthCallbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(min_length=1)
    state: str = Field(min_length=1)


class OAuthCallbackResponse(BaseModel):
    success: bool
    authorization_url: str


class ChannelResponse(BaseModel):
    id: str
    provider: str
    name: str


class StatusResponse(BaseModel):
    connected: bool
    channels: list[ChannelResponse]


def _get_service() -> PostizOAuthService:
    return PostizOAuthService()


@router.get("/connect", response_model=ConnectResponse)
def start_postiz_connect(
    user_id: UUID = Depends(get_current_user_id),
) -> ConnectResponse:
    try:
        result = _get_service().start_connect(user_id)
    except ConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
    except PostizAuthorizationInvalidError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(error),
        ) from error
    except PostizServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(error),
        ) from error
    except RepositoryError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error

    logger.info(
        "Started Postiz connect flow",
        extra={"contos_user_id": str(user_id), "flow": result.flow},
    )
    return ConnectResponse(
        authorization_url=result.authorization_url,
        flow=result.flow,
    )


@router.post("/oauth/callback", response_model=OAuthCallbackResponse)
def complete_postiz_oauth_callback(
    body: OAuthCallbackRequest,
    user_id: UUID = Depends(get_current_user_id),
) -> OAuthCallbackResponse:
    try:
        result = _get_service().complete_oauth_callback(
            contos_user_id=user_id,
            code=body.code,
            state=body.state,
        )
    except ConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
    except PostizOAuthStateError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error
    except PostizAuthorizationInvalidError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(error),
        ) from error
    except PostizServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(error),
        ) from error
    except RepositoryError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error

    logger.info(
        "Completed Postiz OAuth callback",
        extra={"contos_user_id": str(user_id), "flow": result.flow},
    )
    return OAuthCallbackResponse(
        success=True,
        authorization_url=result.authorization_url,
    )


@router.get("/status", response_model=StatusResponse)
def get_postiz_status(
    user_id: UUID = Depends(get_current_user_id),
) -> StatusResponse:
    try:
        status_result = _get_service().get_status(user_id)
    except ConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
    except PostizAuthorizationInvalidError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(error),
        ) from error
    except PostizServiceError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(error),
        ) from error
    except RepositoryError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error

    return StatusResponse(
        connected=status_result.connected,
        channels=[
            ChannelResponse(id=channel.id, provider=channel.provider, name=channel.name)
            for channel in status_result.channels
        ],
    )
