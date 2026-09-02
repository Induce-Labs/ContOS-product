"""Crawl + LLM-summarize website_url from profiling_data onto avatars.website_summary*."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

from agents.base_agent import get_llm_client
from clients.apify_website import (
    ApifyWebsiteCrawler,
    WebsiteCrawlError,
    normalize_website_url,
    website_url_hash,
)
from context.profiling_data import profiling_answer_text

logger = logging.getLogger(__name__)

PROFILE_SUMMARY_MODEL = os.getenv("PROFILE_SUMMARY_MODEL", "google/gemini-2.5-flash")
WEBSITE_SUMMARY_MAX_RETRIES = int(os.getenv("WEBSITE_SUMMARY_MAX_RETRIES", "3"))


class WebsiteSummaryError(Exception):
    """Raised when website summary generation fails (caller may soft-fail)."""


def extract_website_url_from_profiling(profiling: Any) -> str | None:
    if not isinstance(profiling, dict):
        return None
    raw = profiling_answer_text(profiling.get("website_url"))
    if raw is None:
        return None
    return normalize_website_url(raw)


def build_website_summary_prompt(*, website_url: str, crawl_text: str) -> str:
    return "\n".join(
        [
            f"Website URL: {website_url}",
            "",
            "Scraped website content (markdown/text from pages):",
            crawl_text,
            "",
            "Write a concise, structured summary of this website for a marketing AI assistant.",
            "Focus on information useful for understanding the user's profile, brand, business,",
            "positioning, offerings, audience, tone, and other relevant context.",
            "Be factual — only use information from the scraped content above.",
            "Use markdown section headings exactly as listed below.",
            "",
            "## About the Brand / Business",
            "",
            "## Offerings & Positioning",
            "",
            "## Audience & Messaging",
            "",
            "## Tone & Voice Signals",
            "",
            "## Notable Proof Points",
            "",
            "## Website Context Summary",
            "(2-3 short paragraphs optimized for chatbot context)",
        ]
    )


def _call_website_summary_llm(prompt: str) -> str:
    client = get_llm_client()
    last_error: Exception | None = None

    for attempt in range(1, WEBSITE_SUMMARY_MAX_RETRIES + 1):
        try:
            response = client.chat.completions.create(
                model=PROFILE_SUMMARY_MODEL,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You summarize crawled website content into structured markdown "
                            "for a marketing AI assistant. Output markdown only."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=2000,
            )
            content = response.choices[0].message.content
            if not isinstance(content, str) or not content.strip():
                raise WebsiteSummaryError(
                    f"Website summary model returned empty content on attempt {attempt}."
                )
            return content.strip()
        except WebsiteSummaryError:
            raise
        except Exception as exc:
            last_error = exc
            logger.warning(
                "website_summary LLM attempt failed",
                extra={
                    "attempt": attempt,
                    "model": PROFILE_SUMMARY_MODEL,
                    "error": str(exc),
                },
            )

    raise WebsiteSummaryError(
        f"Website summary LLM failed after {WEBSITE_SUMMARY_MAX_RETRIES} attempts: {last_error}"
    ) from last_error


def generate_and_store_website_summary(
    *,
    avatar_id: str,
    avatar_row: dict[str, Any],
    force: bool = False,
) -> dict[str, Any]:
    """Best-effort crawl + summarize. Raises WebsiteSummaryError on hard failures.

    Callers should catch and continue overall profile summarization.
    """
    from db import supabase_client as db

    profiling = avatar_row.get("profiling_data") or {}
    try:
        website_url = extract_website_url_from_profiling(profiling)
    except WebsiteCrawlError as exc:
        db.update_avatar_website_summary(
            avatar_id=avatar_id,
            status="failed",
            error=str(exc)[:2000],
            clear_summary=True,
        )
        raise WebsiteSummaryError(str(exc)) from exc

    if not website_url:
        db.update_avatar_website_summary(
            avatar_id=avatar_id,
            status="skipped",
            error=None,
            clear_summary=True,
        )
        return {
            "avatar_id": avatar_id,
            "website_summary": None,
            "status": "skipped",
            "url": None,
            "cached": False,
        }

    source_hash = website_url_hash(website_url)
    if not force:
        status = avatar_row.get("website_summary_status")
        cached = avatar_row.get("website_summary")
        cached_hash = avatar_row.get("website_summary_source_hash")
        if (
            status == "completed"
            and isinstance(cached, str)
            and cached.strip()
            and cached_hash == source_hash
        ):
            return {
                "avatar_id": avatar_id,
                "website_summary": cached,
                "status": "completed",
                "url": avatar_row.get("website_summary_url") or website_url,
                "generated_at": avatar_row.get("website_summary_generated_at"),
                "cached": True,
            }

    db.update_avatar_website_summary(
        avatar_id=avatar_id,
        status="generating",
        error=None,
        url=website_url,
        source_hash=source_hash,
    )

    try:
        crawler = ApifyWebsiteCrawler()
        crawl_text = crawler.crawl_text(website_url)
        summary = _call_website_summary_llm(
            build_website_summary_prompt(website_url=website_url, crawl_text=crawl_text)
        )
        generated_at = datetime.now(timezone.utc).isoformat()
        db.update_avatar_website_summary(
            avatar_id=avatar_id,
            status="completed",
            summary=summary,
            url=website_url,
            generated_at=generated_at,
            source_hash=source_hash,
            error=None,
        )
        return {
            "avatar_id": avatar_id,
            "website_summary": summary,
            "status": "completed",
            "url": website_url,
            "generated_at": generated_at,
            "cached": False,
        }
    except Exception as exc:
        error_message = str(exc)
        logger.error(
            "website_summary generation failed",
            extra={"avatar_id": avatar_id, "url": website_url, "error": error_message},
        )
        db.update_avatar_website_summary(
            avatar_id=avatar_id,
            status="failed",
            error=error_message[:2000],
            url=website_url,
            source_hash=source_hash,
        )
        raise WebsiteSummaryError(error_message) from exc
