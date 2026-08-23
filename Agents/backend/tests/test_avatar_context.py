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


def test_resolve_uses_tagged_ids_when_owned():
    owned = {"id": "a1", "user_id": "u1", "name": "Personal"}
    with patch("db.supabase_client.fetch_avatar_row", return_value=owned):
        ids = resolve_avatar_ids(
            user_id="u1",
            avatar_id="active",
            tagged_avatar_ids=["a1"],
        )
    assert ids == ["a1"]


def test_resolve_rejects_cross_user_tag():
    other = {"id": "a1", "user_id": "u2", "name": "Other"}
    with patch("db.supabase_client.fetch_avatar_row", return_value=other):
        with pytest.raises(AvatarResolutionError) as exc:
            resolve_avatar_ids(
                user_id="u1",
                avatar_id="active",
                tagged_avatar_ids=["a1"],
            )
    assert exc.value.status_code == 403


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
        "is_default": True,
    }
    with patch("db.supabase_client.assert_avatar_owned"):
        with patch("db.supabase_client.fetch_avatar_row", return_value=avatar):
            profile = fetch_profile(user_id="u1", avatar_id="p1")

    assert profile["source"] == "avatars.profiling_data"
    assert profile["profiling_data"]["product"] == "AI studio"
    assert profile["target_audience"] == "Founders"
