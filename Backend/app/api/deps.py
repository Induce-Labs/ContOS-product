import logging

from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from supabase import Client, create_client

from app.config import Settings, get_settings
from app.errors import ConfigurationError

logger = logging.getLogger(__name__)


def _build_supabase_client(settings: Settings) -> Client:
    if not settings.supabase_service_role_key:
        raise ConfigurationError(
            "SUPABASE_SERVICE_ROLE_KEY is required for authenticated API routes.",
        )

    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def get_current_user_id(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> UUID:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header. Expected Bearer <access_token>.",
        )

    access_token = authorization.removeprefix("Bearer ").strip()

    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing access token.",
        )

    try:
        client = _build_supabase_client(settings)
        user_response = client.auth.get_user(access_token)
    except ConfigurationError as error:
        logger.error("Auth dependency misconfigured", extra={"error": str(error)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication service is not configured.",
        ) from error
    except Exception as error:
        logger.warning("Failed to validate access token", extra={"error": str(error)})
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        ) from error

    if user_response.user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        )

    return UUID(user_response.user.id)
