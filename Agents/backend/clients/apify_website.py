"""Apify Website Content Crawler client for onboarding website context."""

from __future__ import annotations

import logging
import os
import time
from typing import Any
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

DEFAULT_ACTOR_ID = "apify/website-content-crawler"
DEFAULT_WAIT_SECS = 180
DEFAULT_MAX_CRAWL_PAGES = 8
DEFAULT_MAX_CRAWL_DEPTH = 2
DEFAULT_MAX_CONTENT_CHARS = 50_000


class WebsiteCrawlError(Exception):
    """Raised when website crawl configuration or Apify execution fails."""


def normalize_website_url(raw: str | None) -> str | None:
    """Return a normalized https URL or None if empty/invalid."""
    if raw is None:
        return None
    trimmed = str(raw).strip()
    if not trimmed:
        return None

    with_protocol = (
        trimmed if trimmed.lower().startswith(("http://", "https://")) else f"https://{trimmed}"
    )
    try:
        parsed = urlparse(with_protocol)
    except Exception as exc:
        raise WebsiteCrawlError(f"Invalid website URL: {raw!r}") from exc

    if parsed.scheme not in {"http", "https"} or not parsed.netloc or "." not in parsed.netloc:
        raise WebsiteCrawlError(f"Invalid website URL: {raw!r}")

    # Drop fragments; keep path/query for deep links the user entered.
    normalized = parsed._replace(fragment="").geturl()
    return normalized.rstrip("/") if parsed.path in {"", "/"} else normalized


def website_url_hash(url: str) -> str:
    import hashlib

    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def extract_crawl_text(
    items: list[dict[str, Any]],
    *,
    max_chars: int = DEFAULT_MAX_CONTENT_CHARS,
) -> str:
    """Prefer markdown, fall back to text; truncate to a prompt-safe budget."""
    chunks: list[str] = []
    total = 0

    for item in items:
        if not isinstance(item, dict):
            continue
        page_url = str(item.get("url") or item.get("loadedUrl") or "").strip()
        body = item.get("markdown")
        if not isinstance(body, str) or not body.strip():
            body = item.get("text")
        if not isinstance(body, str) or not body.strip():
            continue

        block = f"## Source: {page_url}\n{body.strip()}" if page_url else body.strip()
        if total + len(block) + 2 > max_chars:
            remaining = max_chars - total - 2
            if remaining > 200:
                chunks.append(block[:remaining] + "\n…")
            break
        chunks.append(block)
        total += len(block) + 2

    return "\n\n".join(chunks).strip()


class ApifyWebsiteCrawler:
    """Thin sync client for apify/website-content-crawler."""

    def __init__(
        self,
        *,
        token: str | None = None,
        actor_id: str | None = None,
        wait_secs: int | None = None,
        max_crawl_pages: int | None = None,
        max_crawl_depth: int | None = None,
    ) -> None:
        resolved_token = (token if token is not None else os.getenv("APIFY_API_TOKEN", "")).strip()
        if not resolved_token:
            raise WebsiteCrawlError(
                "APIFY_API_TOKEN is required to crawl website URLs for profiling context."
            )

        self._token = resolved_token
        self._actor_id = (
            actor_id
            or os.getenv("APIFY_WEBSITE_CRAWLER_ACTOR_ID", DEFAULT_ACTOR_ID)
            or DEFAULT_ACTOR_ID
        ).strip()
        self._wait_secs = max(
            30,
            int(
                wait_secs
                if wait_secs is not None
                else os.getenv("WEBSITE_CRAWL_WAIT_SECS", str(DEFAULT_WAIT_SECS))
            ),
        )
        self._max_crawl_pages = max(
            1,
            int(
                max_crawl_pages
                if max_crawl_pages is not None
                else os.getenv("WEBSITE_CRAWL_MAX_PAGES", str(DEFAULT_MAX_CRAWL_PAGES))
            ),
        )
        self._max_crawl_depth = max(
            0,
            int(
                max_crawl_depth
                if max_crawl_depth is not None
                else os.getenv("WEBSITE_CRAWL_MAX_DEPTH", str(DEFAULT_MAX_CRAWL_DEPTH))
            ),
        )

    @staticmethod
    def _actor_id_to_path(actor_id: str) -> str:
        return actor_id.replace("/", "~")

    def crawl(self, website_url: str) -> list[dict[str, Any]]:
        normalized = normalize_website_url(website_url)
        if not normalized:
            raise WebsiteCrawlError("Website URL is empty.")

        actor_input = {
            "startUrls": [{"url": normalized}],
            "maxCrawlPages": self._max_crawl_pages,
            "maxCrawlDepth": self._max_crawl_depth,
            "crawlerType": "cheerio",
            "saveMarkdown": True,
        }

        logger.info(
            "Starting website content crawl",
            extra={
                "website_url": normalized,
                "actor_id": self._actor_id,
                "max_crawl_pages": self._max_crawl_pages,
            },
        )
        return self._run_actor_sync_get_dataset_items(self._actor_id, actor_input)

    def crawl_text(self, website_url: str, *, max_chars: int = DEFAULT_MAX_CONTENT_CHARS) -> str:
        items = self.crawl(website_url)
        text = extract_crawl_text(items, max_chars=max_chars)
        if not text:
            raise WebsiteCrawlError(
                f"Website crawl returned no usable text content for URL: {website_url}"
            )
        return text

    def _run_actor_sync_get_dataset_items(
        self,
        actor_id: str,
        actor_input: dict[str, Any],
    ) -> list[dict[str, Any]]:
        actor_path = self._actor_id_to_path(actor_id)
        # Prefer Authorization header so httpx/access logs never print the token.
        url = (
            f"https://api.apify.com/v2/acts/{actor_path}/run-sync-get-dataset-items"
            f"?timeout={self._wait_secs}"
        )
        headers = {"Authorization": f"Bearer {self._token}"}

        last_error: Exception | None = None
        for attempt in range(1, 3):
            try:
                with httpx.Client(timeout=self._wait_secs + 30) as client:
                    response = client.post(url, json=actor_input, headers=headers)

                if response.status_code >= 400:
                    raise WebsiteCrawlError(
                        f"Apify actor {actor_id} failed with status "
                        f"{response.status_code}: {response.text[:1000]}"
                    )

                payload = response.json()
                if not isinstance(payload, list):
                    raise WebsiteCrawlError(
                        f"Apify actor {actor_id} returned unexpected payload type: {type(payload)!r}"
                    )
                return payload
            except (httpx.HTTPError, WebsiteCrawlError) as error:
                last_error = error
                logger.warning(
                    "Apify website crawl attempt failed",
                    extra={
                        "actor_id": actor_id,
                        "attempt": attempt,
                        "error": str(error),
                    },
                )
                if attempt < 2:
                    time.sleep(2 * attempt)

        raise WebsiteCrawlError(
            f"Apify actor {actor_id} failed after retries: {last_error}"
        ) from last_error
