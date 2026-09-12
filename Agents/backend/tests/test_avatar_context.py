"""Unit tests for Avatar resolution (no live Supabase required)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from context.avatar_resolve import AvatarResolutionError, resolve_avatar_ids


def test_resolve_unions_active_and_tagged_ids():
    def fetch_row(*, avatar_id: str, user_id: str | None = None):
        return {"id": avatar_id, "user_id": "u1", "name": avatar_id}

    with patch("db.supabase_client.assert_avatar_owned") as assert_owned:
        with patch("db.supabase_client.fetch_avatar_row", side_effect=fetch_row):
            ids = resolve_avatar_ids(
                user_id="u1",
                avatar_id="active",
                tagged_avatar_ids=["a1", "a2"],
            )
    assert_owned.assert_called_once_with("active", "u1")
    assert ids == ["active", "a1", "a2"]


def test_resolve_dedupes_active_when_also_tagged():
    def fetch_row(*, avatar_id: str, user_id: str | None = None):
        return {"id": avatar_id, "user_id": "u1", "name": avatar_id}

    with patch("db.supabase_client.assert_avatar_owned"):
        with patch("db.supabase_client.fetch_avatar_row", side_effect=fetch_row):
            ids = resolve_avatar_ids(
                user_id="u1",
                avatar_id="active",
                tagged_avatar_ids=["active", "a1"],
            )
    assert ids == ["active", "a1"]


def test_resolve_rejects_cross_user_tag():
    other = {"id": "a1", "user_id": "u2", "name": "Other"}
    with patch("db.supabase_client.assert_avatar_owned"):
        with patch("db.supabase_client.fetch_avatar_row", return_value=other):
            with pytest.raises(AvatarResolutionError) as exc:
                resolve_avatar_ids(
                    user_id="u1",
                    avatar_id="active",
                    tagged_avatar_ids=["a1"],
                )
    assert exc.value.status_code == 403


def test_resolve_tagged_only_when_no_active():
    def fetch_row(*, avatar_id: str, user_id: str | None = None):
        return {"id": avatar_id, "user_id": "u1", "name": avatar_id}

    with patch("db.supabase_client.fetch_avatar_row", side_effect=fetch_row):
        ids = resolve_avatar_ids(
            user_id="u1",
            avatar_id=None,
            tagged_avatar_ids=["a1", "a2"],
        )
    assert ids == ["a1", "a2"]


def test_resolve_falls_back_to_avatar_id():
    with patch("db.supabase_client.assert_avatar_owned") as assert_owned:
        ids = resolve_avatar_ids(
            user_id="u1",
            avatar_id="p1",
            tagged_avatar_ids=None,
        )
        assert_owned.assert_called_once_with("p1", "u1")
    assert ids == ["p1"]


def test_resolve_default_when_no_avatar():
    default = {"id": "d1", "user_id": "u1", "is_default": True}
    with patch("db.supabase_client.fetch_default_avatar_row", return_value=default):
        ids = resolve_avatar_ids(
            user_id="u1",
            avatar_id=None,
            tagged_avatar_ids=None,
        )
    assert ids == ["d1"]


def test_resolve_empty_when_no_avatars():
    with patch("db.supabase_client.fetch_default_avatar_row", return_value=None):
        ids = resolve_avatar_ids(
            user_id="u1",
            avatar_id=None,
            tagged_avatar_ids=None,
        )
    assert ids == []


def test_profile_from_avatar_prefers_profiling_data():
    from mcp.tools.fetch_profile import fetch_profile

    avatar = {
        "id": "p1",
        "user_id": "u1",
        "name": "Induce Labs",
        "type": "business",
        "profiling_completeness": 100,
        "profiling_data": {
            "product": "AI studio",
            "icp": "Founders",
            "goals": "Leads",
        },
        "profile_summary": "## Goals\nLeads",
        "profile_summary_status": "completed",
        "is_default": True,
    }
    with patch("db.supabase_client.assert_avatar_owned"):
        with patch("db.supabase_client.fetch_avatar_row", return_value=avatar):
            profile = fetch_profile(user_id="u1", avatar_id="p1")

    assert profile["source"] == "avatars.profiling_data"
    assert profile["profiling_data"]["product"] == "AI studio"
    assert profile["target_audience"] == "Founders"
    assert profile["profile_summary"] == "## Goals\nLeads"


def test_assemble_keeps_every_tagged_avatar_profile():
    from context.assembly import assemble_context

    bundle = {
        "multi_avatar": True,
        "avatars": [
            {"id": "a1", "name": "Personal", "type": "personal"},
            {"id": "a2", "name": "Studio", "type": "business"},
        ],
        "profiles": [
            {"avatar_id": "a1", "name": "Personal", "goals": "Poetry"},
            {"avatar_id": "a2", "name": "Studio", "goals": "Leads"},
        ],
        "relevant_insights": [
            {"avatar_id": "a1", "avatar_name": "Personal", "competitor_handle": "poet"},
            {"avatar_id": "a2", "avatar_name": "Studio", "competitor_handle": "saas"},
        ],
        "competitor_context": [
            {"avatar_id": "a1", "avatar_name": "Personal", "summaries": []},
            {"avatar_id": "a2", "avatar_name": "Studio", "summaries": []},
        ],
    }
    ctx = assemble_context(
        profile=None,
        summaries=[],
        playbooks=[],
        user_input="compare both brands",
        agent_type="chatbot",
        avatar_bundle=bundle,
    )
    assert ctx["multi_avatar"] is True
    assert ctx["strategy_mode"] == "multi_avatar"
    assert [p["name"] for p in ctx["avatar_profiles"]] == ["Personal", "Studio"]
    assert [a["name"] for a in ctx["tagged_avatars"]] == ["Personal", "Studio"]
    handles = [row["competitor_handle"] for row in ctx["competitor_intelligence"]]
    assert handles == ["poet", "saas"]


def test_compress_keeps_intel_for_each_tagged_avatar():
    from context.compression import compress_context

    bloated = {
        "multi_avatar": True,
        "avatar_profiles": [
            {"name": "A", "profiling_data": {"x": "y" * 2000}},
            {"name": "B", "profiling_data": {"x": "z" * 2000}},
        ],
        "competitor_intelligence": [
            {
                "avatar_id": "a1",
                "avatar_name": "A",
                "strategic_signals": ["s1"] * 40,
                "top_hooks": ["h1"] * 40,
                "top_content_themes": ["t1"] * 40,
            },
            {
                "avatar_id": "a2",
                "avatar_name": "B",
                "strategic_signals": ["s2"] * 40,
                "top_hooks": ["h2"] * 40,
                "top_content_themes": ["t2"] * 40,
            },
        ],
        "relevant_playbooks": [],
        "user_input": "plan",
    }
    compressed = compress_context(bloated, max_tokens=80)
    avatar_ids = {
        item.get("avatar_id")
        for item in compressed["competitor_intelligence"]
        if isinstance(item, dict)
    }
    assert avatar_ids == {"a1", "a2"}
