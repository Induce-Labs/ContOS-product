import json
import logging
import re
import time
from typing import Any

import httpx
from pydantic import ValidationError

from app.config import Settings
from app.errors import ConfigurationError, LlmServiceError
from app.models.summary import SUMMARY_JSON_SCHEMA, CompetitorSummaryPayload
from app.services.text_sanitize import sanitize_text

logger = logging.getLogger(__name__)

_JSON_FENCE_PATTERN = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE | re.MULTILINE)


class LlmClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._provider = settings.resolved_llm_provider()

        if self._provider == "openrouter" and not settings.openrouter_api_key:
            raise ConfigurationError(
                "OPENROUTER_API_KEY is required when LLM_PROVIDER is openrouter or auto-selected.",
            )

        if self._provider == "openai" and not settings.openai_api_key:
            raise ConfigurationError(
                "OPENAI_API_KEY is required when LLM_PROVIDER is openai or auto-selected.",
            )

    def summarize_competitor_content(
        self,
        competitor_handle: str,
        content_items: list[dict[str, Any]],
        *,
        platform: str = "instagram",
    ) -> tuple[CompetitorSummaryPayload, str]:
        if not content_items:
            raise LlmServiceError("Cannot summarize an empty content batch.")

        prompt = self._build_prompt(competitor_handle, content_items, platform=platform)
        last_error: Exception | None = None

        logger.info(
            "Starting LLM summarization",
            extra={
                "provider": self._provider,
                "platform": platform,
                "competitor_handle": competitor_handle,
                "content_item_count": len(content_items),
                "prompt_chars": len(prompt),
                "model": (
                    self._settings.openrouter_model
                    if self._provider == "openrouter"
                    else self._settings.openai_model
                ),
            },
        )

        for attempt in range(1, self._settings.llm_max_retries + 2):
            try:
                raw_content, model_used = self._call_provider(prompt)
                if not isinstance(raw_content, str) or not raw_content.strip():
                    raise LlmServiceError(
                        "LLM returned empty message content; cannot parse summary JSON.",
                    )
                summary = self._parse_summary(raw_content)
                logger.info(
                    "LLM summarization succeeded",
                    extra={
                        "provider": self._provider,
                        "platform": platform,
                        "model_used": model_used,
                        "attempt": attempt,
                    },
                )
                return summary, model_used
            except (
                httpx.HTTPError,
                LlmServiceError,
                json.JSONDecodeError,
                ValidationError,
                ValueError,
            ) as error:
                last_error = error
                logger.warning(
                    "LLM summarization attempt failed: %s",
                    error,
                    extra={
                        "provider": self._provider,
                        "attempt": attempt,
                        "error_type": type(error).__name__,
                    },
                )
                if attempt <= self._settings.llm_max_retries:
                    time.sleep(2 * attempt)

        raise LlmServiceError(
            f"LLM summarization failed after retries: {last_error}",
        ) from last_error

    def _call_provider(self, prompt: str) -> tuple[str, str]:
        if self._provider == "openrouter":
            return self._call_openrouter(prompt)
        return self._call_openai(prompt)

    def _request_timeout(self) -> httpx.Timeout:
        return httpx.Timeout(
            connect=10.0,
            read=float(self._settings.llm_timeout_secs),
            write=30.0,
            pool=10.0,
        )

    def _chat_completion_body(self, *, model: str, prompt: str) -> dict[str, Any]:
        return {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a fractional CMO analyst. Return only valid JSON "
                        "matching the requested schema."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            "max_tokens": self._settings.llm_max_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "competitor_summary",
                    "schema": SUMMARY_JSON_SCHEMA,
                    "strict": True,
                },
            },
        }

    def _call_openrouter(self, prompt: str) -> tuple[str, str]:
        model = self._settings.openrouter_model

        with httpx.Client(timeout=self._request_timeout()) as client:
            response = client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                },
                json=self._chat_completion_body(model=model, prompt=prompt),
            )

        if response.status_code >= 400:
            raise LlmServiceError(
                f"OpenRouter request failed with status {response.status_code}: {response.text}",
            )

        return self._extract_message_content(response.json()), model

    def _call_openai(self, prompt: str) -> tuple[str, str]:
        model = self._settings.openai_model

        with httpx.Client(timeout=self._request_timeout()) as client:
            response = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json=self._chat_completion_body(model=model, prompt=prompt),
            )

        if response.status_code >= 400:
            raise LlmServiceError(
                f"OpenAI request failed with status {response.status_code}: {response.text}",
            )

        return self._extract_message_content(response.json()), model

    @staticmethod
    def _normalize_json_content(raw_content: str) -> str:
        text = raw_content.strip()
        if text.startswith("```"):
            text = _JSON_FENCE_PATTERN.sub("", text).strip()
        return text

    @staticmethod
    def _extract_message_content(payload: dict[str, Any]) -> str:
        choices = payload.get("choices")

        if not isinstance(choices, list) or not choices:
            raise LlmServiceError("LLM response did not include choices.")

        message = choices[0].get("message", {})
        content = message.get("content")

        if isinstance(content, str):
            return LlmClient._normalize_json_content(content)

        if isinstance(content, list):
            text_parts = [
                part.get("text")
                for part in content
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ]
            if text_parts:
                return LlmClient._normalize_json_content("".join(text_parts))

        raise LlmServiceError("LLM response content was missing or unreadable.")

    def _parse_summary(self, raw_content: str) -> CompetitorSummaryPayload:
        payload = json.loads(self._normalize_json_content(raw_content))
        return CompetitorSummaryPayload.model_validate(payload)

    @staticmethod
    def _build_prompt(
        competitor_handle: str,
        content_items: list[dict[str, Any]],
        *,
        platform: str = "instagram",
    ) -> str:
        content_lines = []
        if platform == "linkedin":
            platform_label = "LinkedIn"
        elif platform == "twitter":
            platform_label = "Twitter/X"
        else:
            platform_label = "Instagram"

        for item in content_items:
            caption = sanitize_text(str(item.get("caption") or "")) or ""
            transcript_raw = item.get("transcript")
            transcript = (
                sanitize_text(transcript_raw.strip())
                if isinstance(transcript_raw, str) and transcript_raw.strip()
                else None
            )
            default_type = (
                "post" if platform in {"linkedin", "twitter"} else "unknown"
            )
            lines = [
                f"- external_id: {item.get('external_id')}",
                f"  content_type: {item.get('content_type') or default_type}",
                f"  caption: {caption}",
                f"  posted_at: {item.get('posted_at')}",
            ]
            if platform != "twitter":
                lines.extend(
                    [
                        f"  likes: {item.get('likes')}",
                        f"  views: {item.get('views')}",
                        f"  shares: {item.get('shares')}",
                        f"  comments_count: {item.get('comments_count')}",
                    ],
                )
            if platform == "linkedin":
                if item.get("author_name"):
                    lines.append(
                        f"  author_name: {sanitize_text(str(item.get('author_name'))) or ''}",
                    )
                if item.get("author_headline"):
                    lines.append(
                        f"  author_headline: {sanitize_text(str(item.get('author_headline'))) or ''}",
                    )
            if platform == "twitter":
                if item.get("author_name"):
                    lines.append(
                        f"  author_name: {sanitize_text(str(item.get('author_name'))) or ''}",
                    )
                if item.get("author_username"):
                    lines.append(
                        f"  author_username: {sanitize_text(str(item.get('author_username'))) or ''}",
                    )
                if item.get("author_followers") is not None:
                    lines.append(f"  author_followers: {item.get('author_followers')}")
                if item.get("author_description"):
                    lines.append(
                        f"  author_description: "
                        f"{sanitize_text(str(item.get('author_description'))) or ''}",
                    )

            if transcript:
                lines.append(f"  transcript: {transcript}")

            content_lines.append("\n".join(lines))

        if platform == "linkedin":
            dataset_guidance = (
                "The dataset includes LinkedIn profile posts. "
                "Use post text and engagement metrics (reactions/likes, comments, shares/reposts)."
            )
        elif platform == "twitter":
            dataset_guidance = (
                "The dataset includes recent Twitter/X profile tweets (last ~7 days). "
                "Engagement metrics are not provided in this dataset — focus on tweet text, "
                "hooks, themes, posting patterns, and author/profile context. "
                "Do not invent or estimate likes, replies, retweets, or views."
            )
        else:
            dataset_guidance = (
                "The dataset includes static posts, carousels, and reels. "
                "Use captions and engagement metrics for all content types. "
                "For reels, use transcripts as supplemental context when provided."
            )

        return (
            f"Analyze {platform_label} content for competitor {competitor_handle}.\n"
            f"{dataset_guidance}\n"
            "Return JSON with:\n"
            "- top_performing_content: ranked list with content_type and why each performed well\n"
            "- recurring_hooks_patterns\n"
            "- content_strategies_themes\n"
            "- strategic_signals: actionable insights for a fractional CMO\n"
            "Do not estimate engagement counts or averages; those are computed separately.\n"
            "For top_performing_content, include external_id and content_type from the dataset, "
            "and still include likes/comments/views/shares fields (they will be overwritten from "
            "scraped metrics).\n"
            "Set aggregated_engagement_metrics counts to 0 and averages to null placeholders.\n\n"
            "Content dataset:\n"
            + "\n\n".join(content_lines)
        )
