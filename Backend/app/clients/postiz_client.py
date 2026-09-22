"""HTTP client for Postiz public API and ContOS Approach B provisioning."""

from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import parse_qsl, quote, urlencode, urlparse, urlunparse
from uuid import UUID

import httpx

from app.config import Settings
from app.errors import (
    ConfigurationError,
    PostizAuthorizationInvalidError,
    PostizServiceError,
)

logger = logging.getLogger(__name__)

_MAX_RETRIES = 2
_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}
_LINKEDIN_AUTH_HOSTS = frozenset({"www.linkedin.com", "linkedin.com"})

# Postiz ContosProvisionService 409 bodies that mean "call rotate-avatar-token".
_ROTATE_REQUIRED_MSG_MARKERS = (
    "call post /internal/contos/rotate-avatar-token",
    "no valid access token",
    "could not be recovered",
)


def _redact_url(url: str) -> str:
    """Strip query/fragment so logs never include codes, state, or secrets."""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


def _extract_postiz_error_message(body: Any) -> str:
    if isinstance(body, dict):
        for key in ("msg", "message", "detail", "error"):
            value = body.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
            if isinstance(value, dict):
                nested = value.get("msg") or value.get("message")
                if isinstance(nested, str) and nested.strip():
                    return nested.strip()
    if isinstance(body, str) and body.strip():
        return body.strip()
    return ""


def is_provision_rotate_required_conflict(status_code: int, body: Any) -> bool:
    """True only for the expected Postiz 409 token-conflict that needs rotate."""
    if status_code != 409:
        return False
    message = _extract_postiz_error_message(body).lower()
    if not message:
        return False
    return any(marker in message for marker in _ROTATE_REQUIRED_MSG_MARKERS)


def strip_unsupported_linkedin_prompt(url: str) -> str:
    """Remove LinkedIn authorize `prompt` query params ContOS does not rely on.

    Postiz historically appended undocumented `prompt=none`, which silently reuses
    the browser LinkedIn session on ContOS reconnect. Official LinkedIn 3-legged
    docs do not list `prompt`; ContOS strips it from URLs returned to the browser
    even if a stale Postiz build still emits it.
    """
    parsed = urlparse(url)
    if "linkedin.com" not in parsed.netloc.lower():
        return url
    if not parsed.path.startswith("/oauth/"):
        return url
    pairs = parse_qsl(parsed.query, keep_blank_values=True)
    filtered = [(key, value) for key, value in pairs if key.lower() != "prompt"]
    if len(filtered) == len(pairs):
        return url
    return urlunparse(parsed._replace(query=urlencode(filtered, quote_via=quote)))


class PostizClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.postiz_base_url:
            raise ConfigurationError("POSTIZ_URL is required for Postiz.")

        self._settings = settings
        self._timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)

    def provision_avatar(self, avatar_id: UUID) -> dict[str, Any]:
        """Ensure a dedicated Postiz org+token for this avatar.

        Rotates only when Postiz returns the specific 409 token-conflict responses
        that instruct ContOS to call rotate-avatar-token. Other 409s propagate.
        """
        secret = self._settings.contos_provision_secret.strip()
        if not secret:
            raise ConfigurationError(
                "CONTOS_PROVISION_SECRET is required for Postiz avatar provisioning.",
            )

        try:
            return self._call_provision_endpoint(
                url=self._settings.postiz_provision_avatar_url,
                avatar_id=avatar_id,
                secret=secret,
            )
        except PostizServiceError as error:
            if not getattr(error, "rotate_required", False):
                raise
            logger.warning(
                "Postiz provision requires token rotate",
                extra={"avatar_id": str(avatar_id)},
            )
            return self.rotate_avatar_token(avatar_id)

    def rotate_avatar_token(self, avatar_id: UUID) -> dict[str, Any]:
        secret = self._settings.contos_provision_secret.strip()
        if not secret:
            raise ConfigurationError(
                "CONTOS_PROVISION_SECRET is required for Postiz avatar token rotation.",
            )
        return self._call_provision_endpoint(
            url=self._settings.postiz_rotate_avatar_token_url,
            avatar_id=avatar_id,
            secret=secret,
        )

    def list_integrations(self, access_token: str) -> list[dict[str, Any]]:
        if not access_token.startswith("pos_"):
            raise PostizServiceError("Postiz access token has an unexpected format.")

        data = self._request_json(
            method="GET",
            url=f"{self._settings.postiz_public_api_base_url}/integrations",
            headers={"Authorization": access_token},
            allow_retries=True,
        )
        if not isinstance(data, list):
            raise PostizServiceError(
                "Postiz integrations response must be a JSON array.",
            )
        return data

    def list_posts(
        self,
        access_token: str,
        *,
        start_date: str,
        end_date: str,
    ) -> list[dict[str, Any]]:
        """GET /posts?startDate=&endDate= — dates are ISO strings passed through unchanged."""
        if not access_token.startswith("pos_"):
            raise PostizServiceError("Postiz access token has an unexpected format.")
        if not start_date.strip() or not end_date.strip():
            raise PostizServiceError("startDate and endDate are required for list_posts.")

        data = self._request_json(
            method="GET",
            url=f"{self._settings.postiz_public_api_base_url}/posts",
            headers={"Authorization": access_token},
            params={"startDate": start_date.strip(), "endDate": end_date.strip()},
            allow_retries=True,
        )
        if isinstance(data, dict) and isinstance(data.get("posts"), list):
            return data["posts"]
        if isinstance(data, list):
            return data
        raise PostizServiceError(
            "Postiz posts response must be a JSON object with a posts array.",
        )

    def create_post(self, access_token: str, payload: dict[str, Any]) -> Any:
        """POST /posts — type: now | schedule | draft | update."""
        if not access_token.startswith("pos_"):
            raise PostizServiceError("Postiz access token has an unexpected format.")
        if not isinstance(payload, dict):
            raise PostizServiceError("Postiz create_post payload must be a JSON object.")

        return self._request_json(
            method="POST",
            url=f"{self._settings.postiz_public_api_base_url}/posts",
            headers={"Authorization": access_token},
            json_body=payload,
            allow_retries=False,
        )

    def delete_post(self, access_token: str, post_id: str) -> Any:
        if not access_token.startswith("pos_"):
            raise PostizServiceError("Postiz access token has an unexpected format.")
        cleaned = post_id.strip()
        if not cleaned:
            raise PostizServiceError("post_id is required for delete_post.")

        return self._request_json(
            method="DELETE",
            url=f"{self._settings.postiz_public_api_base_url}/posts/{cleaned}",
            headers={"Authorization": access_token},
            allow_retries=False,
            allow_empty_body=True,
        )

    def change_post_status(
        self,
        access_token: str,
        post_id: str,
        status: str,
    ) -> Any:
        """PUT /posts/:id/status — status: draft | schedule."""
        if not access_token.startswith("pos_"):
            raise PostizServiceError("Postiz access token has an unexpected format.")
        cleaned = post_id.strip()
        if not cleaned:
            raise PostizServiceError("post_id is required for change_post_status.")
        if status not in {"draft", "schedule"}:
            raise PostizServiceError(
                "Postiz post status must be 'draft' or 'schedule'.",
            )

        return self._request_json(
            method="PUT",
            url=f"{self._settings.postiz_public_api_base_url}/posts/{cleaned}/status",
            headers={"Authorization": access_token},
            json_body={"status": status},
            allow_retries=False,
        )

    def delete_integration(self, access_token: str, integration_id: str) -> Any:
        """DELETE /integrations/:id — soft-deletes channel and cascades its posts."""
        if not access_token.startswith("pos_"):
            raise PostizServiceError("Postiz access token has an unexpected format.")
        cleaned = integration_id.strip()
        if not cleaned:
            raise PostizServiceError("integration_id is required for delete_integration.")

        return self._request_json(
            method="DELETE",
            url=f"{self._settings.postiz_public_api_base_url}/integrations/{cleaned}",
            headers={"Authorization": access_token},
            allow_retries=False,
            allow_empty_body=True,
        )

    def get_linkedin_authorization_url(self, access_token: str) -> str:
        if not access_token.startswith("pos_"):
            raise PostizServiceError("Postiz access token has an unexpected format.")

        data = self._request_json(
            method="GET",
            url=f"{self._settings.postiz_public_api_base_url}/social/linkedin",
            headers={"Authorization": access_token},
            allow_retries=True,
        )
        if not isinstance(data, dict) or not isinstance(data.get("url"), str):
            raise PostizServiceError(
                "Postiz LinkedIn connect response must include a string url field.",
            )
        url = data["url"].strip()
        url = strip_unsupported_linkedin_prompt(url)
        self.validate_navigation_url(url, allow_linkedin=True)
        return url

    def validate_navigation_url(self, url: str, *, allow_linkedin: bool = False) -> None:
        """Reject open redirects; allow only Postiz origin or LinkedIn OAuth when expected."""
        try:
            parsed = urlparse(url)
        except ValueError as error:
            raise PostizServiceError("Navigation URL is malformed.") from error

        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise PostizServiceError("Navigation URL must be an absolute http(s) URL.")

        postiz_origin = urlparse(self._settings.postiz_base_url)
        host = parsed.netloc.lower()
        postiz_host = postiz_origin.netloc.lower()

        if host == postiz_host:
            return

        if allow_linkedin and host in _LINKEDIN_AUTH_HOSTS:
            if not parsed.path.startswith("/oauth/"):
                raise PostizServiceError(
                    "LinkedIn navigation URL path is not an OAuth authorization path.",
                )
            return

        raise PostizServiceError(
            "Navigation URL origin is not allowed for ContOS Postiz OAuth.",
        )

    def _call_provision_endpoint(
        self,
        *,
        url: str,
        avatar_id: UUID,
        secret: str,
    ) -> dict[str, Any]:
        data = self._request_json(
            method="POST",
            url=url,
            headers={"Authorization": f"Bearer {secret}"},
            json_body={"avatar_id": str(avatar_id)},
            allow_retries=True,
            treat_provision_409=True,
        )
        return self._parse_provision_response(data, avatar_id=avatar_id)

    def _parse_provision_response(
        self,
        data: Any,
        *,
        avatar_id: UUID,
    ) -> dict[str, Any]:
        if not isinstance(data, dict):
            raise PostizServiceError("Postiz provision response must be a JSON object.")

        organization_id = data.get("organization_id")
        access_token = data.get("access_token")
        created = data.get("created")

        if not isinstance(organization_id, str) or not organization_id.strip():
            raise PostizServiceError(
                "Postiz provision response is missing organization_id.",
            )
        if not isinstance(access_token, str) or not access_token.startswith("pos_"):
            raise PostizServiceError(
                "Postiz provision response is missing a valid access_token.",
            )

        logger.info(
            "Postiz avatar provision response accepted",
            extra={
                "avatar_id": str(avatar_id),
                "postiz_organization_id": organization_id.strip(),
                # Do not use key "created" — reserved by logging.LogRecord.
                "provision_created": bool(created) if created is not None else None,
            },
        )
        return {
            "organization_id": organization_id.strip(),
            "created": bool(created) if isinstance(created, bool) else None,
            "access_token": access_token,
        }

    def _request_json(
        self,
        *,
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        json_body: dict[str, Any] | None = None,
        params: dict[str, str] | None = None,
        allow_retries: bool,
        treat_provision_409: bool = False,
        allow_empty_body: bool = False,
    ) -> Any:
        last_error: Exception | None = None
        attempts = _MAX_RETRIES + 1 if allow_retries else 1

        for attempt in range(1, attempts + 1):
            try:
                with httpx.Client(timeout=self._timeout) as client:
                    response = client.request(
                        method,
                        url,
                        headers=headers,
                        json=json_body,
                        params=params,
                    )
            except httpx.HTTPError as error:
                last_error = error
                logger.warning(
                    "Postiz HTTP transport failed",
                    extra={
                        "method": method,
                        "url": _redact_url(url),
                        "attempt": attempt,
                        "error_type": type(error).__name__,
                    },
                )
                if attempt < attempts:
                    time.sleep(attempt)
                    continue
                raise PostizServiceError(
                    f"Postiz request failed after retries: {type(error).__name__}",
                ) from error

            if response.status_code == 401:
                if treat_provision_409:
                    # Provision routes use CONTOS_PROVISION_SECRET, not a pos_ token.
                    logger.warning(
                        "Postiz provision endpoint rejected ContOS credentials",
                        extra={
                            "method": method,
                            "url": _redact_url(url),
                            "status_code": 401,
                            "error_type": "provision_unauthorized",
                        },
                    )
                    raise ConfigurationError(
                        "Postiz rejected CONTOS_PROVISION_SECRET (HTTP 401). "
                        "Ensure Backend CONTOS_PROVISION_SECRET exactly matches "
                        "Postiz CONTOS_PROVISION_SECRET (no extra spaces).",
                    )
                raise PostizAuthorizationInvalidError(
                    "Postiz authorization is no longer valid; reconnect required.",
                )

            if response.status_code in _RETRYABLE_STATUS_CODES and attempt < attempts:
                logger.warning(
                    "Postiz returned retryable status",
                    extra={
                        "method": method,
                        "url": _redact_url(url),
                        "status_code": response.status_code,
                        "attempt": attempt,
                    },
                )
                time.sleep(attempt)
                continue

            if response.status_code >= 400:
                body_text = response.text or ""
                body_json: Any = None
                try:
                    body_json = response.json()
                except ValueError:
                    body_json = body_text

                if treat_provision_409 and is_provision_rotate_required_conflict(
                    response.status_code,
                    body_json,
                ):
                    error = PostizServiceError(
                        "Postiz provisioned avatar has no recoverable access token; rotate required.",
                    )
                    setattr(error, "rotate_required", True)
                    raise error

                body_preview = body_text[:200]
                raise PostizServiceError(
                    f"Postiz request failed with status {response.status_code}: {body_preview}",
                )

            body_text = (response.text or "").strip()
            if not body_text:
                if allow_empty_body or response.status_code in {204, 205}:
                    return None
                raise PostizServiceError(
                    "Postiz returned an empty response body.",
                )

            try:
                return response.json()
            except ValueError as error:
                raise PostizServiceError(
                    "Postiz returned a non-JSON response body.",
                ) from error

        raise PostizServiceError(f"Postiz request failed after retries: {last_error}")
