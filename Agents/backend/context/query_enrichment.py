"""Avatar-aware retrieval query construction."""

import json

_MAX_QUERY_CHARS = 600


def build_avatar_aware_query(
    query_text: str,
    avatar_id: str | None,
    user_id: str | None,
) -> str:
    """Append a compact brand brief so retrieval is shaped by the avatar's brand."""
    base = (query_text or "").strip()
    if not avatar_id or not user_id:
        return base[:_MAX_QUERY_CHARS]

    from db import supabase_client as db

    try:
        db.assert_avatar_owned(str(avatar_id), str(user_id))
        row = db.fetch_avatar_row(avatar_id=str(avatar_id), user_id=None)
    except Exception:
        return base[:_MAX_QUERY_CHARS]
    if not row:
        return base[:_MAX_QUERY_CHARS]

    profiling = row.get("profiling_data") or {}
    if isinstance(profiling, str):
        try:
            profiling = json.loads(profiling)
        except Exception:
            profiling = {}
    flat = profiling if isinstance(profiling, dict) else {}

    industry = str(flat.get("expertise") or flat.get("product") or "").strip()
    audience = str(
        flat.get("ideal_reader") or flat.get("audience") or flat.get("icp") or ""
    ).strip()
    voice = str(flat.get("brand_voice") or flat.get("voice") or "").strip()

    bits = []
    if industry:
        bits.append(industry[:60])
    if audience:
        bits.append(f"audience: {audience[:80]}")
    if voice:
        bits.append(f"voice: {voice[:60]}")
    if not bits:
        return base[:_MAX_QUERY_CHARS]

    return f"{base} Brand context: {' | '.join(bits)}."[:_MAX_QUERY_CHARS]