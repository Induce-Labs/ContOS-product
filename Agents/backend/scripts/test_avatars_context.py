"""Unit checks for avatar normalization + context assembly."""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from avatars import normalize_avatar_profiles, profile_from_avatar
from context.assembly import assemble_context


def main() -> int:
    profiles = [
        {
            "id": "avatar_personal",
            "label": "Personal",
            "business_name": "Sara Al-Rashid",
            "brand_voice": "Warm poetic",
            "target_audience": "Creatives",
            "goals": "Grow poetry brand",
            "industry": "Personal branding",
            "evil_field": "should_be_stripped",
        },
        {
            "id": "avatar_business_1",
            "label": "Business 1",
            "business_name": "NovaLedger",
            "brand_voice": "Operator-first",
            "target_audience": "SaaS founders",
            "goals": "Pipeline",
            "industry": "B2B SaaS",
        },
    ]
    cleaned = normalize_avatar_profiles(
        ["avatar_personal", "avatar_business_1"], profiles
    )
    assert len(cleaned) == 2
    assert "evil_field" not in cleaned[0]
    assert cleaned[0]["business_name"] == "Sara Al-Rashid"

    try:
        normalize_avatar_profiles(["avatar_hacker"], profiles)
        raise AssertionError("expected ValueError for unknown id")
    except ValueError:
        pass

    ctx = assemble_context(
        profile=None,
        summaries=[],
        playbooks=[],
        user_input="create a strategy plan",
        agent_type="linkedin",
        avatar_bundle={
            "multi_avatar": True,
            "avatars": cleaned,
            "profiles": [profile_from_avatar(item) for item in cleaned],
            "relevant_insights": [],
            "competitor_context": [],
        },
    )
    assert ctx["brand_profile"]["business_name"] == "Sara Al-Rashid"
    assert len(ctx["tagged_avatars"]) == 2
    assert ctx["avatar_profiles"][1]["business_name"] == "NovaLedger"
    primary = profile_from_avatar(cleaned[0])
    assert primary["source"] == "tagged_avatar"
    print("OK avatar normalize + assemble_context")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
