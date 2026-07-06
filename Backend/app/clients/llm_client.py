import json
import logging
import time
from typing import Any

import httpx

from app.config import Settings
from app.errors import ConfigurationError, LlmServiceError
from app.models.summary import SUMMARY_JSON_SCHEMA, CompetitorSummaryPayload

logger = logging.getLogger(__name__)


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
    ) -> tuple[CompetitorSummaryPayload, str]:
        if not content_items:
            raise LlmServiceError("Cannot summarize an empty content batch.")

        prompt = self._build_prompt(competitor_handle, content_items)
        last_error: Exception | None = None

        for attempt in range(1, self._settings.llm_max_retries + 2):
            try:
                raw_content, model_used = self._call_provider(prompt)
                summary = self._parse_summary(raw_content)
                return summary, model_used
            except (httpx.HTTPError, LlmServiceError, json.JSONDecodeError, ValueError) as error:
                last_error = error
                logger.warning(
                    "LLM summarization attempt failed",
                    extra={
                        "provider": self._provider,
                        "attempt": attempt,
                        "error": str(error),
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

    def _call_openrouter(self, prompt: str) -> tuple[str, str]:
        model = self._settings.openrouter_model

        with httpx.Client(timeout=120) as client:
            response = client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                },
                json={
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
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "competitor_summary",
                            "schema": SUMMARY_JSON_SCHEMA,
                            "strict": True,
                        },
                    },
                },
            )

        if response.status_code >= 400:
            raise LlmServiceError(
                f"OpenRouter request failed with status {response.status_code}: {response.text}",
            )

        return self._extract_message_content(response.json()), model

    def _call_openai(self, prompt: str) -> tuple[str, str]:
        model = self._settings.openai_model

        with httpx.Client(timeout=120) as client:
            response = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
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
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "competitor_summary",
                            "schema": SUMMARY_JSON_SCHEMA,
                            "strict": True,
                        },
                    },
                },
            )

        if response.status_code >= 400:
            raise LlmServiceError(
                f"OpenAI request failed with status {response.status_code}: {response.text}",
            )

        return self._extract_message_content(response.json()), model

    @staticmethod
    def _extract_message_content(payload: dict[str, Any]) -> str:
        choices = payload.get("choices")

        if not isinstance(choices, list) or not choices:
            raise LlmServiceError("LLM response did not include choices.")

        message = choices[0].get("message", {})
        content = message.get("content")

        if isinstance(content, str):
            return content

        if isinstance(content, list):
            text_parts = [
                part.get("text")
                for part in content
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ]
            if text_parts:
                return "".join(text_parts)

        raise LlmServiceError("LLM response content was missing or unreadable.")

    @staticmethod
    def _parse_summary(raw_content: str) -> CompetitorSummaryPayload:
        payload = json.loads(raw_content)
        return CompetitorSummaryPayload.model_validate(payload)

    @staticmethod
    def _build_prompt(competitor_handle: str, content_items: list[dict[str, Any]]) -> str:
        content_lines = []

        for item in content_items:
            lines = [
                f"- external_id: {item.get('external_id')}",
                f"  content_type: {item.get('content_type')}",
                f"  caption: {item.get('caption') or ''}",
                f"  likes: {item.get('likes')}",
                f"  views: {item.get('views')}",
                f"  shares: {item.get('shares')}",
                f"  comments_count: {item.get('comments_count')}",
                f"  posted_at: {item.get('posted_at')}",
            ]
            transcript = item.get("transcript")
            if isinstance(transcript, str) and transcript.strip():
                lines.append(f"  transcript: {transcript.strip()}")

            content_lines.append("\n".join(lines))

        return (
            f"Analyze Instagram content for competitor {competitor_handle}.\n"
            "The dataset includes static posts, carousels, and reels. "
            "Use captions and engagement metrics for all content types. "
            "For reels, use transcripts as supplemental context when provided.\n"
            "Return JSON with:\n"
            "- top_performing_content: ranked list with content_type and why each performed well\n"
            "- recurring_hooks_patterns\n"
            "- content_strategies_themes\n"
            "- aggregated_engagement_metrics: total_content_count, reel_count, post_count, "
            "carousel_count, and averages across all content with valid metrics\n"
            "- strategic_signals: actionable insights for a fractional CMO\n\n"
            "Content dataset:\n"
            + "\n\n".join(content_lines)
        )
