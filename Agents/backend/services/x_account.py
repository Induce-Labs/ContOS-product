"""X tweet length from the account type stored for an avatar."""

from __future__ import annotations

from db import supabase_client as db

STANDARD_TWEET_LIMIT = 280
PREMIUM_TWEET_LIMIT = 4000


def tweet_limit_for_avatar(avatar_id: str) -> int:
    """280 unless this avatar's Postiz connection is marked premium.

    A missing row or a null type stays at 280. Any other stored value is an error.
    The caller already checked that this user owns the avatar. This does not
    accept a limit from the browser.
    """
    avatar = str(avatar_id or "").strip()
    if not avatar:
        raise RuntimeError("avatar_id is required to read the X account type.")
    response = (
        db._require_client()
        .table("postiz_connections")
        .select("x_account_type")
        .eq("avatar_id", avatar)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    if not rows:
        return STANDARD_TWEET_LIMIT
    value = rows[0].get("x_account_type")
    if value is None or value == "standard":
        return STANDARD_TWEET_LIMIT
    if value == "premium":
        return PREMIUM_TWEET_LIMIT
    raise RuntimeError(
        f"Stored X account type {value!r} for avatar {avatar} is not premium or standard.",
    )
