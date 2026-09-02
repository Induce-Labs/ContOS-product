"""Unit tests for profile summary generation (no live LLM / Supabase)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from context.profiling_data import format_profiling_qa_for_prompt, profile_from_avatar_row
from services.profile_summary import (
    ProfileSummaryError,
    build_profile_summary_prompt,
    generate_and_store_profile_summary,
)


def test_format_profiling_qa_for_prompt_supports_object_and_string_answers():
    profiling = {
        "content_goal": {
            "question_key": "content_goal",
            "question": "What is the primary goal of your content?",
            "answer": "Thought Leadership",
        },
        "website_url": "https://example.com",
    }
    pairs = format_profiling_qa_for_prompt(profiling)
    assert len(pairs) == 2
    assert pairs[0]["key"] == "content_goal"
    assert pairs[0]["answer"] == "Thought Leadership"


def test_build_profile_summary_prompt_includes_avatar_metadata():
    avatar = {
        "id": "a1",
        "name": "Acme",
        "type": "business_1",
        "profiling_data": {
            "biz_01": {
                "question": "Buying trigger?",
                "answer": "Failed vendor",
            }
        },
    }
    prompt = build_profile_summary_prompt(avatar)
    assert "Acme" in prompt
    assert "business_1" in prompt
    assert "Buying trigger?" in prompt
    assert "Failed vendor" in prompt
    assert "## Narrative Summary" in prompt


def test_build_profile_summary_prompt_requires_answers():
    with pytest.raises(ProfileSummaryError):
        build_profile_summary_prompt({"id": "a1", "profiling_data": {}})


def test_profile_from_avatar_row_includes_summary_fields():
    row = {
        "id": "p1",
        "user_id": "u1",
        "name": "Brand",
        "type": "personal_branding",
        "profiling_data": {"content_goal": "Leads"},
        "profile_summary": "## Goals\nLeads",
        "profile_summary_status": "completed",
        "profile_summary_generated_at": "2026-01-01T00:00:00Z",
        "profile_summary_error": None,
        "website_summary": None,
        "website_summary_status": "skipped",
    }
    profile = profile_from_avatar_row(row, "u1")
    assert profile["profile_summary"] == "## Goals\nLeads"
    assert profile["profile_summary_status"] == "completed"
    assert profile["website_summary_status"] == "skipped"


def test_generate_and_store_profile_summary_returns_cached_when_hash_matches():
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
                    "cached": False,
                },
            ):
                result = generate_and_store_profile_summary(
                    avatar_id="a1",
                    user_id="u1",
                    force=False,
                )

    assert result["cached"] is True
    assert result["profile_summary"] == "Cached summary"


def test_generate_and_store_profile_summary_persists_llm_output():
    avatar = {
        "id": "a1",
        "user_id": "u1",
        "name": "Brand",
        "type": "business",
        "profiling_data": {
            "content_goal": {
                "question": "Goal?",
                "answer": "Leads",
            }
        },
        "profile_summary_status": "pending",
    }

    mock_update = MagicMock()
    with patch("db.supabase_client.assert_avatar_owned", return_value=avatar):
        with patch("db.supabase_client.update_avatar_profile_summary", mock_update):
            with patch(
                "services.profile_summary.generate_and_store_website_summary",
                return_value={
                    "avatar_id": "a1",
                    "website_summary": None,
                    "status": "skipped",
                    "cached": False,
                },
            ):
                with patch(
                    "services.profile_summary._call_summary_llm",
                    return_value="## Narrative Summary\nTest",
                ):
                    result = generate_and_store_profile_summary(
                        avatar_id="a1",
                        user_id="u1",
                        force=True,
                    )

    assert result["profile_summary"] == "## Narrative Summary\nTest"
    assert result["status"] == "completed"
    assert mock_update.call_count >= 2
