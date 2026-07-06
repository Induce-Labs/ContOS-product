import logging
import time
from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings
from app.errors import ApifyServiceError, ConfigurationError

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
        self._wait_secs = settings.apify_wait_secs
        self._lookback_days = settings.scrape_lookback_days

    def scrape_instagram_profile(self, profile_url: str) -> list[dict[str, Any]]:
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

    def transcribe_reel_urls(self, reel_urls: list[str]) -> dict[str, str]:
        if not reel_urls:
            return {}

        actor_input = {
            "urls": reel_urls,
            "include_timestamps": False,
            "enable_diarization": False,
            "language": "auto",
        }

        logger.info(
            "Starting reel transcription batch",
            extra={
                "actor_id": self._transcriber_actor_id,
                "reel_count": len(reel_urls),
            },
        )

        items = self._run_actor_sync_get_dataset_items(self._transcriber_actor_id, actor_input)
        transcript_map = self._map_transcription_items(items, reel_urls)

        logger.info(
            "Reel transcription batch complete",
            extra={
                "urls_requested": len(reel_urls),
                "transcripts_mapped": len(transcript_map),
            },
        )

        return transcript_map

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
    def _map_transcription_items(
        items: list[dict[str, Any]],
        requested_urls: list[str],
    ) -> dict[str, str]:
        transcripts_by_url: dict[str, str] = {}

        for item in items:
            source_url = (
                item.get("url")
                or item.get("sourceUrl")
                or item.get("inputUrl")
                or item.get("start_urls")
            )
            transcript = (
                item.get("transcript")
                or item.get("text")
                or item.get("transcription")
                or item.get("result")
            )

            if isinstance(source_url, str) and isinstance(transcript, str) and transcript.strip():
                transcripts_by_url[source_url] = transcript.strip()

        if transcripts_by_url:
            return transcripts_by_url

        if len(items) == len(requested_urls):
            for index, item in enumerate(items):
                transcript = (
                    item.get("transcript")
                    or item.get("text")
                    or item.get("transcription")
                    or item.get("result")
                )
                if isinstance(transcript, str) and transcript.strip():
                    transcripts_by_url[requested_urls[index]] = transcript.strip()

        return transcripts_by_url
