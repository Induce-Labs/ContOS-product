"""HTTP client for Postiz v2.23.0 OAuth token exchange and Public API."""

from __future__ import annotations

import logging
import time
from typing import Any
from urllib.parse import urlparse

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


def _redact_url(url: str) -> str:
    """Strip query/fragment so logs never include codes, state, or secrets."""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


class PostizClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.postiz_base_url:
            raise ConfigurationError("POSTIZ_URL is required for Postiz OAuth.")
        if not settings.postiz_client_id:
            raise ConfigurationError("POSTIZ_CLIENT_ID is required for Postiz OAuth.")
        if not settings.postiz_client_secret:
            raise ConfigurationError("POSTIZ_CLIENT_SECRET is required for Postiz OAuth.")

        self._settings = settings
        self._timeout = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)

    def exchange_code_for_token(self, code: str) -> dict[str, Any]:
        """Exchange a one-time authorization code for a Postiz organization token.

        Expected response shape (v2.23.0):
          { "id": "<orgId>", "cus": <paymentId|null>, "access_token": "pos_...", "token_type": "bearer" }
        """
        if not code or not code.strip():
            raise PostizServiceError("Postiz authorization code is required.")

        payload = {
            "grant_type": "authorization_code",
            "code": code.strip(),
            "client_id": self._settings.postiz_client_id,
            "client_secret": self._settings.postiz_client_secret,
        }
        response = self._request_json(
            method="POST",
            url=self._settings.postiz_oauth_token_url,
            json_body=payload,
            # Authorization-code exchange is single-use; do not retry on success ambiguity.
            allow_retries=False,
        )
        return self._parse_token_response(response)

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

    def _parse_token_response(self, data: Any) -> dict[str, Any]:
        if not isinstance(data, dict):
            raise PostizServiceError("Postiz token response must be a JSON object.")

        organization_id = data.get("id")
        access_token = data.get("access_token")
        token_type = data.get("token_type")
        cus = data.get("cus")

        if not isinstance(organization_id, str) or not organization_id.strip():
            raise PostizServiceError("Postiz token response is missing organization id.")
        if not isinstance(access_token, str) or not access_token.startswith("pos_"):
            raise PostizServiceError("Postiz token response is missing a valid access_token.")
        if token_type != "bearer":
            raise PostizServiceError(
                f"Postiz token response has unexpected token_type={token_type!r}.",
            )
        if cus is not None and not isinstance(cus, str):
            raise PostizServiceError("Postiz token response field cus must be a string or null.")

        return {
            "id": organization_id.strip(),
            "cus": cus,
            "access_token": access_token,
            "token_type": token_type,
        }

    def _request_json(
        self,
        *,
        method: str,
        url: str,
        headers: dict[str, str] | None = None,
        json_body: dict[str, Any] | None = None,
        allow_retries: bool,
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
                body_preview = (response.text or "")[:200]
                raise PostizServiceError(
                    f"Postiz request failed with status {response.status_code}: {body_preview}",
                )

            try:
                return response.json()
            except ValueError as error:
                raise PostizServiceError(
                    "Postiz returned a non-JSON response body.",
                ) from error

        raise PostizServiceError(f"Postiz request failed after retries: {last_error}")
