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


def test_assemble_strips_raw_profiling_data_from_all_avatar_profiles():
    import json

    from context.assembly import assemble_context

    primary = {
        "avatar_id": "a1",
        "name": "Primary",
        "brand_voice": "Direct",
        "profile_context": "SM primary context",
        "profile_context_source": "supermemory",
        "profiling_data": {"content_goal": {"question": "G?", "answer": "Leads"}},
        "profile_summary": None,
    }
    secondary = {
        "avatar_id": "a2",
        "name": "Secondary",
        "brand_voice": "Warm",
        "goals": "Awareness",
        "website_summary": "Secondary site blurb",
        "profiling_data": {
            "brand_voice": {"question": "V?", "answer": "Warm"},
            "content_goal": {"question": "G?", "answer": "Awareness"},
        },
    }
    # Secondary must not inherit primary profile_context.
    assert "profile_context" not in secondary

    ctx = assemble_context(
        profile=primary,
        summaries=[],
        playbooks=[],
        user_input="compare both",
        agent_type="linkedin",
        avatar_bundle={
            "multi_avatar": True,
            "avatars": [
                {"id": "a1", "name": "Primary"},
                {"id": "a2", "name": "Secondary"},
            ],
            "profiles": [primary, secondary],
            "relevant_insights": [],
            "competitor_context": [],
        },
    )

    brand = ctx["brand_profile"]
    profiles = ctx["avatar_profiles"]
    assert brand["profile_context"] == "SM primary context"
    assert "profiling_data" not in brand
    assert brand.get("profiling_answer_count") == 1
    assert brand["brand_voice"] == "Direct"

    assert len(profiles) == 2
    assert profiles[0]["avatar_id"] == "a1"
    assert "profiling_data" not in profiles[0]
    assert profiles[0]["profile_context"] == "SM primary context"

    assert profiles[1]["avatar_id"] == "a2"
    assert "profiling_data" not in profiles[1]
    assert profiles[1].get("profiling_answer_count") == 2
    assert profiles[1]["brand_voice"] == "Warm"
    assert profiles[1]["goals"] == "Awareness"
    assert profiles[1]["website_summary"] == "Secondary site blurb"
    assert "profile_context" not in profiles[1]

    # Final serialized LLM CONTEXT shape (no content dump of answers).
    serialized = json.dumps(ctx, default=str)
    assert "profiling_data" not in serialized
    assert "SM primary context" in serialized
    assert profiles[1]["name"] == "Secondary"


def test_assemble_single_avatar_also_omits_raw_profiling_data():
    from context.assembly import assemble_context

    profile = {
        "avatar_id": "a1",
        "name": "Solo",
        "profiling_data": {"a": {"question": "Q", "answer": "A"}},
        "brand_voice": "Clear",
    }
    ctx = assemble_context(
        profile=profile,
        summaries=[],
        playbooks=[],
        user_input="hello",
        agent_type="chatbot",
        avatar_bundle={
            "multi_avatar": False,
            "avatars": [{"id": "a1", "name": "Solo"}],
            "profiles": [profile],
        },
    )
    assert "profiling_data" not in ctx["brand_profile"]
    assert "profiling_data" not in ctx["avatar_profiles"][0]
    assert ctx["brand_profile"]["brand_voice"] == "Clear"
    assert ctx["brand_profile"]["profiling_answer_count"] == 1


def test_omit_raw_profiling_data_preserves_secondary_own_context():
    """Secondary may already carry its own profile_context; never invent/copy primary's."""
    import json

    from context.assembly import assemble_context
    from context.profiling_data import omit_raw_profiling_data_for_llm

    primary_ctx = "PRIMARY_SM_ONLY"
    secondary_ctx = "SECONDARY_OWN_CONTEXT"

    stripped = omit_raw_profiling_data_for_llm(
        {
            "avatar_id": "a2",
            "profile_context": secondary_ctx,
            "profiling_data": {"q": {"answer": "raw should go"}},
            "goals": "Growth",
        }
    )
    assert stripped is not None
    assert "profiling_data" not in stripped
    assert stripped["profile_context"] == secondary_ctx
    assert stripped["goals"] == "Growth"

    primary = {
        "avatar_id": "a1",
        "profile_context": primary_ctx,
        "profile_context_source": "supermemory",
        "brand_voice": "Direct",
    }
    secondary_no_ctx = {
        "avatar_id": "a3",
        "name": "NoCtx",
        "brand_voice": "Casual",
        "profiling_data": {"only": {"answer": "leak"}},
    }
    secondary_with_ctx = {
        "avatar_id": "a2",
        "name": "HasCtx",
        "profile_context": secondary_ctx,
        "profiling_data": {"only": {"answer": "leak2"}},
    }

    ctx = assemble_context(
        profile=primary,
        summaries=[],
        playbooks=[],
        user_input="multi",
        agent_type="linkedin",
        avatar_bundle={
            "multi_avatar": True,
            "avatars": [
                {"id": "a1", "name": "P"},
                {"id": "a2", "name": "HasCtx"},
                {"id": "a3", "name": "NoCtx"},
            ],
            "profiles": [primary, secondary_with_ctx, secondary_no_ctx],
        },
    )
    by_id = {p["avatar_id"]: p for p in ctx["avatar_profiles"]}
    assert by_id["a1"]["profile_context"] == primary_ctx
    assert by_id["a2"]["profile_context"] == secondary_ctx
    assert "profile_context" not in by_id["a3"]
    assert by_id["a3"]["brand_voice"] == "Casual"
    for p in ctx["avatar_profiles"]:
        assert "profiling_data" not in p

    blob = json.dumps(ctx, default=str)
    assert "profiling_data" not in blob
    assert primary_ctx in blob
    assert secondary_ctx in blob
    assert "leak" not in blob


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
