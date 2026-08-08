import logging
import time
from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings
from app.errors import ApifyServiceError, ConfigurationError
from app.models.transcription import ReelTranscriptionResult

logger = logging.getLogger(__name__)


class ApifyClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.apify_api_token:
            raise ConfigurationError(
                "APIFY_API_TOKEN is required to run the competitor scraping pipeline.",
            )

        self._token = settings.apify_api_token
        self._instagram_actor_id = settings.apify_instagram_actor_id
        self._transcriber_actor_id = settings.apify_transcriber_actor_id
        self._linkedin_actor_id = settings.apify_linkedin_actor_id
        self._linkedin_max_posts = max(10, settings.linkedin_max_posts)
        self._wait_secs = settings.apify_wait_secs
        self._lookback_days = settings.scrape_lookback_days
        self._instagram_session_id = settings.apify_instagram_session_id.strip()
        self._transcribe_batch_size = max(1, settings.transcribe_batch_size)
        self._transcribe_retry_delay_secs = max(0.0, settings.transcribe_retry_delay_secs)

    def scrape_instagram_profile(self, profile_url: str) -> list[dict[str, Any]]:
        if "linkedin.com" in profile_url.lower():
            raise ApifyServiceError(
                "Refusing to scrape a LinkedIn URL with the Instagram actor. "
                f"Use scrape_linkedin_profile instead. Got: {profile_url}",
            )

        actor_input = {
            "username": [profile_url],
            "resultsLimit": 50,
            "onlyPostsNewerThan": f"{self._lookback_days} days",
            "dataDetailLevel": "basicData",
        }

        logger.info(
            "Starting Instagram profile scrape",
            extra={
                "profile_url": profile_url,
                "actor_id": self._instagram_actor_id,
                "lookback_days": self._lookback_days,
            },
        )

        items = self._run_actor_sync_get_dataset_items(self._instagram_actor_id, actor_input)

        logger.info(
            "Instagram profile scrape returned items",
            extra={
                "profile_url": profile_url,
                "item_count": len(items),
            },
        )

        return items

    def scrape_instagram_reels(self, profile_url: str) -> list[dict[str, Any]]:
        return self.scrape_instagram_profile(profile_url)

    def scrape_linkedin_profile(self, profile_url: str) -> list[dict[str, Any]]:
        actor_input = {
            "profiles": [profile_url],
            "max_posts": self._linkedin_max_posts,
        }

        logger.info(
            "Starting LinkedIn profile scrape",
            extra={
                "profile_url": profile_url,
                "actor_id": self._linkedin_actor_id,
                "max_posts": self._linkedin_max_posts,
            },
        )

        items = self._run_actor_sync_get_dataset_items(self._linkedin_actor_id, actor_input)

        logger.info(
            "LinkedIn profile scrape returned items",
            extra={
                "profile_url": profile_url,
                "item_count": len(items),
            },
        )

        return items

    def transcribe_reel_urls(self, reel_urls: list[str]) -> dict[str, ReelTranscriptionResult]:
        if not reel_urls:
            return {}

        logger.info(
            "Starting reel transcription batch",
            extra={
                "actor_id": self._transcriber_actor_id,
                "reel_count": len(reel_urls),
                "batch_size": self._transcribe_batch_size,
                "has_instagram_session": bool(self._instagram_session_id),
            },
        )

        results_by_normalized: dict[str, ReelTranscriptionResult] = {}

        for offset in range(0, len(reel_urls), self._transcribe_batch_size):
            batch = reel_urls[offset : offset + self._transcribe_batch_size]
            items = self._run_transcriber_actor(batch)
            batch_results = self._parse_transcription_items(items, batch)
            self._merge_transcription_results(results_by_normalized, batch_results)

        urls_missing_transcript = [
            url
            for url in reel_urls
            if not self._result_for_url(url, results_by_normalized).succeeded
        ]

        if urls_missing_transcript:
            logger.info(
                "Retrying reel transcription individually",
                extra={"retry_count": len(urls_missing_transcript)},
            )

        for index, url in enumerate(urls_missing_transcript):
            items = self._run_transcriber_actor([url])
            retry_results = self._parse_transcription_items(items, [url])
            self._merge_transcription_results(results_by_normalized, retry_results)

            if index < len(urls_missing_transcript) - 1 and self._transcribe_retry_delay_secs > 0:
                time.sleep(self._transcribe_retry_delay_secs)

        aligned_results: dict[str, ReelTranscriptionResult] = {}
        success_count = 0

        for url in reel_urls:
            result = self._result_for_url(url, results_by_normalized)
            if not result.succeeded and result.error_message is None:
                result = ReelTranscriptionResult(
                    error_message="Transcriber returned no transcript for this reel URL.",
                )
            aligned_results[url] = result
            if result.succeeded:
                success_count += 1

        logger.info(
            "Reel transcription batch complete",
            extra={
                "urls_requested": len(reel_urls),
                "transcripts_mapped": success_count,
                "failures": len(reel_urls) - success_count,
            },
        )

        return aligned_results

    def _run_transcriber_actor(self, reel_urls: list[str]) -> list[dict[str, Any]]:
        actor_input = self._build_transcriber_input(reel_urls)
        return self._run_actor_sync_get_dataset_items(self._transcriber_actor_id, actor_input)

    def _build_transcriber_input(self, reel_urls: list[str]) -> dict[str, Any]:
        if len(reel_urls) == 1:
            actor_input: dict[str, Any] = {
                "videoUrl": reel_urls[0],
                "bulkUrls": [],
            }
        else:
            actor_input = {"bulkUrls": reel_urls}

        if self._instagram_session_id:
            actor_input["sessionid"] = self._instagram_session_id

        return actor_input

    def _run_actor_sync_get_dataset_items(
        self,
        actor_id: str,
        actor_input: dict[str, Any],
    ) -> list[dict[str, Any]]:
        actor_path = self._actor_id_to_path(actor_id)
        url = (
            f"https://api.apify.com/v2/acts/{actor_path}/run-sync-get-dataset-items"
            f"?token={quote(self._token)}&timeout={self._wait_secs}"
        )

        last_error: Exception | None = None

        for attempt in range(1, 3):
            try:
                with httpx.Client(timeout=self._wait_secs + 30) as client:
                    response = client.post(url, json=actor_input)

                if response.status_code >= 400:
                    raise ApifyServiceError(
                        "Apify actor "
                        f"{actor_id} failed with status {response.status_code}: {response.text}",
                    )

                payload = response.json()

                if not isinstance(payload, list):
                    raise ApifyServiceError(
                        f"Apify actor {actor_id} returned unexpected payload type: {type(payload)!r}",
                    )

                return payload
            except (httpx.HTTPError, ApifyServiceError) as error:
                last_error = error
                logger.warning(
                    "Apify actor attempt failed",
                    extra={
                        "actor_id": actor_id,
                        "attempt": attempt,
                        "error": str(error),
                    },
                )
                if attempt < 2:
                    time.sleep(2 * attempt)

        raise ApifyServiceError(
            f"Apify actor {actor_id} failed after retries: {last_error}",
        ) from last_error

    @staticmethod
    def _actor_id_to_path(actor_id: str) -> str:
        return actor_id.replace("/", "~")

    @staticmethod
    def _normalize_instagram_url(url: str) -> str:
        return url.strip().rstrip("/").split("?", maxsplit=1)[0]

    @staticmethod
    def _result_for_url(
        url: str,
        results_by_normalized: dict[str, ReelTranscriptionResult],
    ) -> ReelTranscriptionResult:
        normalized = ApifyClient._normalize_instagram_url(url)
        return results_by_normalized.get(normalized, ReelTranscriptionResult())

    @staticmethod
    def _merge_transcription_results(
        target: dict[str, ReelTranscriptionResult],
        incoming: dict[str, ReelTranscriptionResult],
    ) -> None:
        for key, result in incoming.items():
            storage_key = ApifyClient._normalize_instagram_url(key)
            existing = target.get(storage_key)

            if existing is None or (not existing.succeeded and result.succeeded):
                target[storage_key] = result
            elif (
                not existing.succeeded
                and not result.succeeded
                and result.error_message
                and not existing.error_message
            ):
                target[storage_key] = result

    @staticmethod
    def _parse_transcription_items(
        items: list[dict[str, Any]],
        requested_urls: list[str],
    ) -> dict[str, ReelTranscriptionResult]:
        results: dict[str, ReelTranscriptionResult] = {}

        for item in items:
            source_url = (
                item.get("url")
                or item.get("sourceUrl")
                or item.get("inputUrl")
                or item.get("videoUrl")
                or item.get("start_urls")
            )
            err_msg = item.get("errMsg") or item.get("error")
            transcript = (
                item.get("transcript")
                or item.get("text")
                or item.get("transcription")
                or item.get("result")
            )

            if isinstance(err_msg, str) and err_msg.strip():
                logger.warning(
                    "Transcriber returned error for item",
                    extra={
                        "error": err_msg.strip(),
                        "item_url": source_url,
                    },
                )
                if isinstance(source_url, str) and source_url.strip():
                    results[source_url] = ReelTranscriptionResult(error_message=err_msg.strip())
                continue

            if isinstance(source_url, str) and isinstance(transcript, str) and transcript.strip():
                results[source_url] = ReelTranscriptionResult(transcript=transcript.strip())

        if len(items) == len(requested_urls):
            for index, item in enumerate(items):
                requested_url = requested_urls[index]
                normalized_requested = ApifyClient._normalize_instagram_url(requested_url)
                existing = results.get(requested_url) or results.get(normalized_requested)
                if existing is not None and existing.succeeded:
                    continue

                transcript = (
                    item.get("transcript")
                    or item.get("text")
                    or item.get("transcription")
                    or item.get("result")
                )
                err_msg = item.get("errMsg") or item.get("error")

                if isinstance(transcript, str) and transcript.strip():
                    results[requested_url] = ReelTranscriptionResult(transcript=transcript.strip())
                elif isinstance(err_msg, str) and err_msg.strip():
                    results[requested_url] = ReelTranscriptionResult(error_message=err_msg.strip())

        return results
