"""LinkedIn parser and pipeline branch tests."""

from pathlib import Path
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.services.linkedin_parser import parse_linkedin_posts
from app.services.pipeline import PipelineError, run_competitor_pipeline, run_linkedin_competitor_pipeline

REPO_ROOT = Path(__file__).resolve().parents[2]
LINKEDIN_MIGRATION = (
    REPO_ROOT / "supabase" / "migrations" / "20260804120000_linkedin_scraping.sql"
)


class TestLinkedInParser:
    def test_maps_core_fields_and_reactions(self) -> None:
        items = [
            {
                "urn": "urn:li:activity:123",
                "postUrl": "https://www.linkedin.com/feed/update/urn:li:activity:123",
                "text": "Shipping LinkedIn research",
                "postedAt": "2026-07-01T12:00:00Z",
                "reactions": {"total": 42},
                "numComments": 7,
                "numShares": 3,
                "author": {"name": "Jane Doe", "headline": "Founder"},
            },
            {
                "id": "dup-skip",
                "error": "Profile not found",
            },
        ]

        parsed = parse_linkedin_posts(items)

        assert len(parsed) == 1
        post = parsed[0]
        assert post["external_id"] == "urn:li:activity:123"
        assert post["caption"] == "Shipping LinkedIn research"
        assert post["likes"] == 42
        assert post["comments_count"] == 7
        assert post["shares"] == 3
        assert post["author_name"] == "Jane Doe"
        assert post["author_headline"] == "Founder"
        assert post["posted_at"] == "2026-07-01T12:00:00+00:00"
        assert post["raw_payload"]["urn"] == "urn:li:activity:123"

    def test_dedupes_external_ids_and_falls_back_to_url(self) -> None:
        items = [
            {
                "url": "https://www.linkedin.com/posts/jane_activity-999-abc",
                "text": "first",
                "likes": 1,
            },
            {
                "url": "https://www.linkedin.com/posts/jane_activity-999-abc",
                "text": "duplicate url path id",
                "likes": 2,
            },
        ]

        parsed = parse_linkedin_posts(items)
        assert len(parsed) == 1
        assert parsed[0]["external_id"] == "jane_activity-999-abc"


    def test_select_linkedin_content_for_llm_caps_and_truncates(self) -> None:
        from app.services.linkedin_parser import select_linkedin_content_for_llm

        items = [
            {
                "external_id": f"id-{i}",
                "caption": "x" * 2000,
                "likes": i,
                "comments_count": 0,
                "shares": 0,
            }
            for i in range(30)
        ]

        selected = select_linkedin_content_for_llm(items, max_items=5, caption_max_chars=50)

        assert len(selected) == 5
        assert selected[0]["external_id"] == "id-29"
        assert len(selected[0]["caption"]) == 51  # 50 chars + ellipsis
        assert selected[0]["caption"].endswith("…")


class TestLinkedInMigrationContract:
    def test_migration_creates_dedicated_tables_and_platform_check(self) -> None:
        sql = LINKEDIN_MIGRATION.read_text(encoding="utf-8")

        assert "linkedin_scraped_content" in sql
        assert "linkedin_content_summaries" in sql
        assert "UNIQUE (competitor_id, external_id)" in sql
        assert "'linkedin'" in sql
        assert "platform = 'linkedin'" in sql
        assert "ENABLE ROW LEVEL SECURITY" in sql


class TestLinkedInPipelineBranch:
    def test_resolve_platform_prefers_linkedin_url(self) -> None:
        from app.services.pipeline import resolve_competitor_platform

        assert (
            resolve_competitor_platform(
                {
                    "platform": "instagram",
                    "handle_or_url": "https://www.linkedin.com/in/jane-doe/",
                },
            )
            == "linkedin"
        )

    def test_instagram_pipeline_refuses_linkedin_url(self) -> None:
        from app.services.pipeline import run_instagram_competitor_pipeline

        with pytest.raises(PipelineError, match="LinkedIn competitors must use the LinkedIn pipeline"):
            run_instagram_competitor_pipeline(
                avatar_id=uuid4(),
                competitor={
                    "id": str(uuid4()),
                    "handle_or_url": "https://www.linkedin.com/in/jane-doe/",
                    "platform": "linkedin",
                },
                settings=MagicMock(),
                repository=MagicMock(),
                apify_client=MagicMock(),
                llm_client=MagicMock(),
            )

    def test_run_competitor_pipeline_routes_linkedin(self, monkeypatch: pytest.MonkeyPatch) -> None:
        called: dict[str, object] = {}

        def fake_linkedin(**kwargs: object) -> None:
            called["kwargs"] = kwargs

        monkeypatch.setattr(
            "app.services.pipeline.run_linkedin_competitor_pipeline",
            fake_linkedin,
        )

        competitor = {
            "id": str(uuid4()),
            "handle_or_url": "https://www.linkedin.com/in/jane-doe/",
            "platform": "linkedin",
        }

        run_competitor_pipeline(
            avatar_id=uuid4(),
            competitor=competitor,
            settings=MagicMock(),
            repository=MagicMock(),
            apify_client=MagicMock(),
            llm_client=MagicMock(),
        )

        assert called["kwargs"]["competitor"]["platform"] == "linkedin"

    def test_empty_scrape_raises_pipeline_error(self) -> None:
        competitor_id = uuid4()
        avatar_id = uuid4()
        repository = MagicMock()
        apify_client = MagicMock()
        apify_client.scrape_linkedin_profile.return_value = []

        with pytest.raises(PipelineError, match="No LinkedIn posts found"):
            run_linkedin_competitor_pipeline(
                avatar_id=avatar_id,
                competitor={
                    "id": str(competitor_id),
                    "handle_or_url": "https://www.linkedin.com/in/jane-doe/",
                    "platform": "linkedin",
                },
                settings=MagicMock(),
                repository=repository,
                apify_client=apify_client,
                llm_client=MagicMock(),
            )

        repository.upsert_linkedin_scraped_content.assert_not_called()
        repository.replace_linkedin_content_summary.assert_not_called()

    def test_summary_writes_only_to_linkedin_table(self) -> None:
        competitor_id = uuid4()
        avatar_id = uuid4()
        repository = MagicMock()
        apify_client = MagicMock()
        llm_client = MagicMock()

        apify_client.scrape_linkedin_profile.return_value = [
            {
                "urn": "urn:li:activity:1",
                "text": "Hello LinkedIn",
                "likes": 10,
                "numComments": 2,
                "numShares": 1,
            },
        ]
        repository.get_linkedin_content_for_summary.return_value = [
            {
                "external_id": "urn:li:activity:1",
                "caption": "Hello LinkedIn",
                "likes": 10,
                "shares": 1,
                "comments_count": 2,
                "posted_at": None,
                "author_name": None,
                "author_headline": None,
            },
        ]

        summary_model = MagicMock()
        summary_model.model_dump.return_value = {"overview": "ok"}
        llm_client.summarize_competitor_content.return_value = (summary_model, "test-model")
        repository.replace_content_summary = MagicMock()

        run_linkedin_competitor_pipeline(
            avatar_id=avatar_id,
            competitor={
                "id": str(competitor_id),
                "handle_or_url": "https://www.linkedin.com/in/jane-doe/",
                "platform": "linkedin",
            },
            settings=MagicMock(),
            repository=repository,
            apify_client=apify_client,
            llm_client=llm_client,
        )

        repository.upsert_linkedin_scraped_content.assert_called_once()
        repository.replace_linkedin_content_summary.assert_called_once()
        repository.replace_content_summary.assert_not_called()
        llm_client.summarize_competitor_content.assert_called_once()
        call_kwargs = llm_client.summarize_competitor_content.call_args.kwargs
        assert call_kwargs["platform"] == "linkedin"
