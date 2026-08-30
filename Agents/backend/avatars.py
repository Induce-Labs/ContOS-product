"""Validate and normalize client-supplied avatar profiles for agent context."""

from __future__ import annotations

from typing import Any

ALLOWED_AVATAR_IDS = frozenset(
    {"avatar_personal", "avatar_business_1", "avatar_business_2"}
)

_ALLOWED_FIELDS = frozenset(
    {
        "id",
        "label",
        "role",
        "initials",
        "business_name",
        "brand_voice",
        "target_audience",
        "goals",
        "industry",
        "bio",
        "platforms",
        "offers",
        "name",
    }
)

_MAX_AVATARS = 3
_MAX_STRING_LEN = 800
_MAX_LIST_ITEMS = 12


def _clip_str(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if len(text) > _MAX_STRING_LEN:
        return text[:_MAX_STRING_LEN]
    return text


def _clip_str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value[:_MAX_LIST_ITEMS]:
        s = _clip_str(item)
        if s:
            out.append(s)
    return out


def normalize_avatar_profiles(
    avatar_ids: list[str] | None,
    avatar_profiles: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Return at most 3 allowlisted, field-stripped avatar profiles.

    Raises ValueError on invalid ids or oversized payloads.
    """
    ids = [str(i).strip() for i in (avatar_ids or []) if str(i).strip()]
    if len(ids) > _MAX_AVATARS:
        raise ValueError(f"At most {_MAX_AVATARS} avatars can be tagged per request.")
    for avatar_id in ids:
        if avatar_id not in ALLOWED_AVATAR_IDS:
            raise ValueError(
                f"Unknown avatar id '{avatar_id}'. "
                f"Allowed: {', '.join(sorted(ALLOWED_AVATAR_IDS))}"
            )

    by_id: dict[str, dict[str, Any]] = {}
    for raw in avatar_profiles or []:
        if not isinstance(raw, dict):
            continue
        avatar_id = _clip_str(raw.get("id"))
        if not avatar_id or avatar_id not in ALLOWED_AVATAR_IDS:
            continue
        cleaned: dict[str, Any] = {"id": avatar_id}
        for key, value in raw.items():
            if key not in _ALLOWED_FIELDS or key == "id":
                continue
            if key in {"platforms", "offers"}:
                cleaned[key] = _clip_str_list(value)
            else:
                cleaned[key] = _clip_str(value)
        by_id[avatar_id] = cleaned

    # Preserve selection order from avatar_ids; fall back to profile order
    ordered_ids = ids or list(by_id.keys())[:_MAX_AVATARS]
    result: list[dict[str, Any]] = []
    for avatar_id in ordered_ids:
        if avatar_id in by_id:
            result.append(by_id[avatar_id])
        elif avatar_id in ids:
            # ID requested but no profile payload — skip rather than invent
            continue
    if len(result) > _MAX_AVATARS:
        result = result[:_MAX_AVATARS]
    return result


def profile_from_avatar(avatar: dict[str, Any]) -> dict[str, Any]:
    """Map an avatar dict onto the brand_profile shape used by agents."""
    name = (
        _clip_str(avatar.get("business_name"))
        or _clip_str(avatar.get("name"))
        or _clip_str(avatar.get("label"))
    )
    return {
        "business_name": name,
        "brand_voice": _clip_str(avatar.get("brand_voice")),
        "target_audience": _clip_str(avatar.get("target_audience")),
        "goals": _clip_str(avatar.get("goals")),
        "industry": _clip_str(avatar.get("industry")),
        "bio": _clip_str(avatar.get("bio")),
        "platforms": _clip_str_list(avatar.get("platforms")),
        "offers": _clip_str_list(avatar.get("offers")),
        "avatar_id": _clip_str(avatar.get("id")),
        "avatar_role": _clip_str(avatar.get("role")),
        "source": "tagged_avatar",
    }
