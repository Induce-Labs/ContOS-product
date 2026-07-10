from app.clients.apify_client import ApifyClient
from app.models.transcription import ReelTranscriptionResult


class TestTranscriptionParsing:
    def test_maps_successful_transcript_by_url(self) -> None:
        items = [
            {
                "url": "https://www.instagram.com/p/ABC123/",
                "text": "Hello world",
                "errMsg": "",
            },
        ]
        requested = ["https://www.instagram.com/p/ABC123/"]

        results = ApifyClient._parse_transcription_items(items, requested)

        assert results["https://www.instagram.com/p/ABC123/"].succeeded is True
        assert results["https://www.instagram.com/p/ABC123/"].transcript == "Hello world"

    def test_maps_actor_error_message(self) -> None:
        items = [
            {
                "url": "https://www.instagram.com/p/FAILED1/",
                "text": "",
                "errMsg": "Video unavailable",
            },
        ]
        requested = ["https://www.instagram.com/p/FAILED1/"]

        results = ApifyClient._parse_transcription_items(items, requested)

        assert results["https://www.instagram.com/p/FAILED1/"].succeeded is False
        assert results["https://www.instagram.com/p/FAILED1/"].error_message == "Video unavailable"

    def test_index_fallback_when_urls_missing_from_payload(self) -> None:
        items = [
            {"text": "First transcript", "errMsg": ""},
            {"text": "", "errMsg": "Blocked by Instagram"},
        ]
        requested = [
            "https://www.instagram.com/p/ONE/",
            "https://www.instagram.com/p/TWO/",
        ]

        results = ApifyClient._parse_transcription_items(items, requested)

        assert results["https://www.instagram.com/p/ONE/"].transcript == "First transcript"
        assert results["https://www.instagram.com/p/TWO/"].error_message == "Blocked by Instagram"

    def test_merge_prefers_success_over_failure(self) -> None:
        target: dict[str, ReelTranscriptionResult] = {}
        url = "https://www.instagram.com/p/MERGE/"

        ApifyClient._merge_transcription_results(
            target,
            {url: ReelTranscriptionResult(error_message="temporary failure")},
        )
        ApifyClient._merge_transcription_results(
            target,
            {url: ReelTranscriptionResult(transcript="final transcript")},
        )

        normalized = ApifyClient._normalize_instagram_url(url)
        assert target[normalized].transcript == "final transcript"
