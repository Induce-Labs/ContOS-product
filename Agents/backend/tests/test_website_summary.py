"""Unit tests for website crawl helpers and website/profile summary orchestration."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from clients.apify_website import (
    WebsiteCrawlError,
    extract_crawl_text,
    normalize_website_url,
    website_url_hash,
)
from context.profiling_data import profile_from_avatar_row
from services.profile_summary import (
    build_profile_summary_prompt,
    generate_and_store_profile_summary,
)
from services.website_summary import (
    WebsiteSummaryError,
    extract_website_url_from_profiling,
    generate_and_store_website_summary,
)


def test_normalize_website_url_adds_https_and_rejects_invalid():
    assert normalize_website_url("example.com") == "https://example.com"
    assert normalize_website_url("https://Example.com/") == "https://Example.com"
    assert normalize_website_url("") is None
    assert normalize_website_url(None) is None
    with pytest.raises(WebsiteCrawlError):
        normalize_website_url("not a url")


def test_extract_crawl_text_prefers_markdown_and_truncates():
    items = [
        {"url": "https://a.com", "markdown": "Hello A", "text": "ignored"},
        {"url": "https://b.com", "text": "Hello B"},
        {"url": "https://c.com", "markdown": ""},
    ]
    text = extract_crawl_text(items, max_chars=10_000)
    assert "Hello A" in text
    assert "Hello B" in text
    assert "ignored" not in text

    tiny = extract_crawl_text(
        [{"url": "https://a.com", "markdown": "x" * 500}],
        max_chars=250,
    )
    assert tiny.endswith("…")
    assert len(tiny) <= 260


def test_extract_website_url_from_profiling_object_and_string():
    assert (
        extract_website_url_from_profiling(
            {"website_url": {"answer": "https://brand.com/about"}}
        )
        == "https://brand.com/about"
    )
    assert extract_website_url_from_profiling({"website_url": "brand.com"}) == "https://brand.com"
    assert extract_website_url_from_profiling({}) is None


def test_website_summary_skips_when_no_url():
    mock_update = MagicMock()
    avatar = {"id": "a1", "profiling_data": {"content_goal": "Leads"}}

    with patch("db.supabase_client.update_avatar_website_summary", mock_update):
        result = generate_and_store_website_summary(
            avatar_id="a1",
            avatar_row=avatar,
            force=False,
        )

    assert result["status"] == "skipped"
    mock_update.assert_called_once()
    assert mock_update.call_args.kwargs["status"] == "skipped"
    assert mock_update.call_args.kwargs["clear_summary"] is True


def test_website_summary_returns_cached_when_hash_matches():
    url = "https://example.com"
    avatar = {
        "id": "a1",
        "profiling_data": {"website_url": url},
        "website_summary": "## About\nCached",
        "website_summary_status": "completed",
        "website_summary_source_hash": website_url_hash(url),
        "website_summary_url": url,
        "website_summary_generated_at": "2026-01-01T00:00:00Z",
    }

    with patch("db.supabase_client.update_avatar_website_summary") as mock_update:
        result = generate_and_store_website_summary(
            avatar_id="a1",
            avatar_row=avatar,
            force=False,
        )

    assert result["cached"] is True
    assert result["website_summary"] == "## About\nCached"
    mock_update.assert_not_called()


def test_website_summary_empty_crawl_marks_failed():
    avatar = {
        "id": "a1",
        "profiling_data": {"website_url": "https://example.com"},
    }
    mock_update = MagicMock()
    mock_crawler = MagicMock()
    mock_crawler.crawl_text.side_effect = WebsiteCrawlError("no usable text")

    with patch("db.supabase_client.update_avatar_website_summary", mock_update):
        with patch(
            "services.website_summary.ApifyWebsiteCrawler",
            return_value=mock_crawler,
        ):
            with pytest.raises(WebsiteSummaryError):
                generate_and_store_website_summary(
                    avatar_id="a1",
                    avatar_row=avatar,
                    force=True,
                )

    statuses = [call.kwargs["status"] for call in mock_update.call_args_list]
    assert "generating" in statuses
    assert "failed" in statuses


def test_build_profile_summary_prompt_includes_website_context():
    avatar = {
        "id": "a1",
        "name": "Acme",
        "type": "business",
        "profiling_data": {
            "content_goal": {"question": "Goal?", "answer": "Leads"},
        },
        "website_summary": "## About the Brand\nAcme sells widgets.",
        "website_summary_url": "https://acme.com",
    }
    prompt = build_profile_summary_prompt(avatar)
    assert "Website / brand site context" in prompt
    assert "Acme sells widgets." in prompt
    assert "https://acme.com" in prompt


def test_profile_from_avatar_row_includes_website_summary_fields():
    row = {
        "id": "p1",
        "user_id": "u1",
        "name": "Brand",
        "type": "personal_branding",
        "profiling_data": {"website_url": "https://me.com"},
        "profile_summary": "## Goals\nLeads",
        "profile_summary_status": "completed",
        "website_summary": "## About\nPersonal site",
        "website_summary_status": "completed",
        "website_summary_url": "https://me.com",
    }
    profile = profile_from_avatar_row(row, "u1")
    assert profile["website_summary"] == "## About\nPersonal site"
    assert profile["website_summary_status"] == "completed"
    assert profile["website_url"] == "https://me.com"


def test_generate_profile_summary_continues_when_website_fails():
    avatar = {
        "id": "a1",
        "user_id": "u1",
        "name": "Brand",
        "type": "business",
        "profiling_data": {
            "content_goal": {"question": "Goal?", "answer": "Leads"},
            "website_url": "https://broken.example",
        },
        "profile_summary_status": "pending",
    }

    mock_profile_update = MagicMock()
    with patch("db.supabase_client.assert_avatar_owned", return_value=avatar):
        with patch(
            "db.supabase_client.update_avatar_profile_summary",
            mock_profile_update,
        ):
            with patch(
                "services.profile_summary.generate_and_store_website_summary",
                side_effect=WebsiteSummaryError("crawl failed"),
            ):
                with patch(
                    "services.profile_summary._call_summary_llm",
                    return_value="## Narrative Summary\nOk without site",
                ):
                    result = generate_and_store_profile_summary(
                        avatar_id="a1",
                        user_id="u1",
                        force=True,
                    )

    assert result["profile_summary"] == "## Narrative Summary\nOk without site"
    assert result["website_summary_status"] == "failed"
    assert result["status"] == "completed"


def test_generate_profile_summary_cached_still_runs_website_step():
    avatar = {
        "id": "a1",
        "user_id": "u1",
        "name": "Brand",
        "type": "business",
        "profiling_data": {"content_goal": "Leads"},
        "profile_summary": "Cached summary",
        "profile_summary_status": "completed",
        "profile_summary_source_hash": "abc123",
        "profile_summary_generated_at": "2026-01-01T00:00:00Z",
    }

    with patch("db.supabase_client.assert_avatar_owned", return_value=avatar):
        with patch(
            "services.profile_summary.profiling_data_hash",
            return_value="abc123",
        ):
            with patch(
                "services.profile_summary.generate_and_store_website_summary",
                return_value={
                    "avatar_id": "a1",
                    "website_summary": None,
                    "status": "skipped",
                    "url": None,
                    "cached": False,
                },
            ) as mock_website:
                result = generate_and_store_profile_summary(
                    avatar_id="a1",
                    user_id="u1",
                    force=False,
                )

    mock_website.assert_called_once()
    assert result["cached"] is True
    assert result["profile_summary"] == "Cached summary"
    assert result["website_summary_status"] == "skipped"
