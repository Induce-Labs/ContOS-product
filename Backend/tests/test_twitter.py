"""Twitter parser and pipeline branch tests."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.pipeline import PipelineError, run_competitor_pipeline, run_twitter_competitor_pipeline
from app.services.twitter_parser import extract_twitter_handle, parse_twitter_tweets

REPO_ROOT = Path(__file__).resolve().parents[2]
TWITTER_MIGRATION = (
    REPO_ROOT / "supabase" / "migrations" / "20260918120000_twitter_scraping.sql"
)


class TestTwitterParser:
    def test_maps_core_fields_without_metrics_columns(self) -> None:
        recent = (datetime.now(tz=UTC) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
        items = [
            {
                "id": "1234567890",
                "tweetUrl": "https://x.com/nasa/status/1234567890",
                "text": "Launch day",
                "createdAt": recent,
                "likeCount": 999,
                "retweetCount": 50,
                "author": {
                    "name": "NASA",
                    "username": "nasa",
                    "followers": 1000,
                    "description": "Explore the universe",
                },
            },
            {
                "resultType": "diagnostic",
                "status": "ok",
            },
            {
                "id": "old-tweet",
                "text": "Too old",
                "createdAt": (datetime.now(tz=UTC) - timedelta(days=30)).isoformat(),
            },
        ]

        parsed = parse_twitter_tweets(items, lookback_days=7)

        assert len(parsed) == 1
        tweet = parsed[0]
        assert tweet["external_id"] == "1234567890"
        assert tweet["caption"] == "Launch day"
        assert tweet["author_name"] == "NASA"
        assert tweet["author_username"] == "nasa"
        assert tweet["author_followers"] == 1000
        assert tweet["author_description"] == "Explore the universe"
        assert "likes" not in tweet
        assert "comments_count" not in tweet
        assert "shares" not in tweet
        assert "views" not in tweet
        assert tweet["raw_payload"]["id"] == "1234567890"

    def test_dedupes_and_extracts_id_from_status_url(self) -> None:
        recent = (datetime.now(tz=UTC) - timedelta(hours=2)).isoformat()
        items = [
            {
                "url": "https://x.com/openai/status/999",
                "text": "first",
                "createdAt": recent,
            },
            {
                "url": "https://x.com/openai/status/999",
                "text": "duplicate",
                "createdAt": recent,
            },
        ]

        parsed = parse_twitter_tweets(items, lookback_days=7)
        assert len(parsed) == 1
        assert parsed[0]["external_id"] == "999"

    def test_extract_twitter_handle(self) -> None:
        assert extract_twitter_handle("@NASA") == "NASA"
        assert extract_twitter_handle("https://x.com/openai") == "openai"
        assert extract_twitter_handle("https://twitter.com/elonmusk/") == "elonmusk"

        with pytest.raises(ValueError, match="non-Twitter"):
            extract_twitter_handle("https://www.linkedin.com/in/jane/")


class TestTwitterMigrationContract:
    def test_migration_creates_dedicated_tables_without_metrics(self) -> None:
        sql = TWITTER_MIGRATION.read_text(encoding="utf-8")

        assert "twitter_scraped_content" in sql
        assert "twitter_content_summaries" in sql
        assert "UNIQUE (competitor_id, external_id)" in sql
        assert "platform = 'twitter'" in sql
        assert "ENABLE ROW LEVEL SECURITY" in sql
        assert "likes" not in sql
        assert "comments_count" not in sql
        assert "shares" not in sql
        assert "views" not in sql
        assert "match_twitter_content_summaries" in sql


class TestTwitterPipelineBranch:
    def test_resolve_platform_prefers_x_url(self) -> None:
        from app.services.pipeline import resolve_competitor_platform

        assert (
            resolve_competitor_platform(
                {
                    "platform": "instagram",
                    "handle_or_url": "https://x.com/nasa",
                },
            )
            == "twitter"
        )

    def test_instagram_pipeline_refuses_twitter_url(self) -> None:
        from app.services.pipeline import run_instagram_competitor_pipeline

        with pytest.raises(PipelineError, match="Twitter competitors must use the Twitter pipeline"):
            run_instagram_competitor_pipeline(
                avatar_id=uuid4(),
                competitor={
                    "id": str(uuid4()),
                    "handle_or_url": "https://x.com/nasa",
                    "platform": "twitter",
                },
                settings=MagicMock(),
                repository=MagicMock(),
                apify_client=MagicMock(),
                llm_client=MagicMock(),
            )

    def test_run_competitor_pipeline_routes_twitter(self, monkeypatch: pytest.MonkeyPatch) -> None:
        called: dict[str, object] = {}

        def fake_twitter(**kwargs: object) -> None:
            called["kwargs"] = kwargs

        monkeypatch.setattr(
            "app.services.pipeline.run_twitter_competitor_pipeline",
            fake_twitter,
        )

        competitor = {
            "id": str(uuid4()),
            "handle_or_url": "https://x.com/nasa",
            "platform": "twitter",
        }

        run_competitor_pipeline(
            avatar_id=uuid4(),
            competitor=competitor,
            settings=MagicMock(),
            repository=MagicMock(),
            apify_client=MagicMock(),
            llm_client=MagicMock(),
        )

        assert called["kwargs"]["competitor"]["platform"] == "twitter"

    def test_empty_scrape_raises_pipeline_error(self) -> None:
        competitor_id = uuid4()
        avatar_id = uuid4()
        repository = MagicMock()
        repository.is_cancel_requested.return_value = False
        apify_client = MagicMock()
        apify_client.scrape_twitter_profile.return_value = []
        settings = MagicMock()
        settings.scrape_lookback_days = 7

        with pytest.raises(PipelineError, match="No Twitter tweets found"):
            run_twitter_competitor_pipeline(
                avatar_id=avatar_id,
                competitor={
                    "id": str(competitor_id),
                    "handle_or_url": "https://x.com/nasa",
                    "platform": "twitter",
                },
                settings=settings,
                repository=repository,
                apify_client=apify_client,
                llm_client=MagicMock(),
            )

        repository.upsert_twitter_scraped_content.assert_not_called()
        repository.replace_twitter_content_summary.assert_not_called()

    def test_summary_writes_only_to_twitter_table(self) -> None:
        competitor_id = uuid4()
        avatar_id = uuid4()
        repository = MagicMock()
        apify_client = MagicMock()
        llm_client = MagicMock()
        settings = MagicMock()
        settings.scrape_lookback_days = 7

        recent = (datetime.now(tz=UTC) - timedelta(hours=1)).isoformat()
        apify_client.scrape_twitter_profile.return_value = [
            {
                "id": "1",
                "text": "Hello Twitter",
                "createdAt": recent,
                "author": {"name": "NASA", "username": "nasa"},
            },
        ]
        repository.get_twitter_content_for_summary.return_value = [
            {
                "external_id": "1",
                "caption": "Hello Twitter",
                "posted_at": recent,
                "author_name": "NASA",
                "author_username": "nasa",
                "author_followers": None,
                "author_description": None,
            },
        ]

        summary_model = MagicMock()
        summary_model.model_dump.return_value = {"overview": "ok"}
        llm_client.summarize_competitor_content.return_value = (summary_model, "test-model")
        repository.replace_content_summary = MagicMock()
        repository.replace_linkedin_content_summary = MagicMock()

        run_twitter_competitor_pipeline(
            avatar_id=avatar_id,
            competitor={
                "id": str(competitor_id),
                "handle_or_url": "https://x.com/nasa",
                "platform": "twitter",
            },
            settings=settings,
            repository=repository,
            apify_client=apify_client,
            llm_client=llm_client,
        )

        repository.upsert_twitter_scraped_content.assert_called_once()
        repository.replace_twitter_content_summary.assert_called_once()
        repository.replace_content_summary.assert_not_called()
        repository.replace_linkedin_content_summary.assert_not_called()
        llm_client.summarize_competitor_content.assert_called_once()
        call_kwargs = llm_client.summarize_competitor_content.call_args.kwargs
        assert call_kwargs["platform"] == "twitter"
