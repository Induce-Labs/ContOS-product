import logging
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from app.services.text_sanitize import sanitize_json_value, sanitize_optional_str, sanitize_text

logger = logging.getLogger(__name__)

TranscriptionStatus = Literal[
    "pending",
    "in_progress",
    "completed",
    "failed",
    "not_applicable",
]


def _first_non_empty(item: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        value = item.get(key)
        if value is not None and value != "":
            return value
    return None


def _parse_posted_at(value: Any) -> datetime | None:
    if value is None:
        return None

    if isinstance(value, (int, float)):
        timestamp = float(value)
        if timestamp > 1_000_000_000_000:
            timestamp /= 1000
        return datetime.fromtimestamp(timestamp, tz=UTC)

    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(normalized)
        except ValueError:
            return None

    return None


def _is_reel_item(item: dict[str, Any]) -> bool:
    item_type = str(_first_non_empty(item, ["type", "productType", "mediaType"]) or "").lower()
    url = str(_first_non_empty(item, ["url", "postUrl", "inputUrl"]) or "").lower()

    if "reel" in item_type or item_type in {"video", "clips"}:
        return True

    return "/reel/" in url or "/reels/" in url


def _resolve_content_type(item: dict[str, Any], *, is_reel: bool) -> str:
    if is_reel:
        return "reel"

    item_type = str(_first_non_empty(item, ["type", "productType", "mediaType"]) or "").lower()

    if "carousel" in item_type or "sidecar" in item_type:
        return "carousel"
    if item_type in {"video", "clips"}:
        return "video"
    if item_type in {"image", "photo", "graphimage"}:
        return "post"

    return "post"


def _resolve_transcription_status(
    *,
    is_reel: bool,
    transcript: str | None,
) -> TranscriptionStatus:
    if not is_reel:
        return "not_applicable"

    if transcript and transcript.strip():
        return "completed"

    return "pending"


def parse_instagram_posts(
    raw_items: list[dict[str, Any]],
    *,
    lookback_days: int,
) -> list[dict[str, Any]]:
    cutoff = datetime.now(tz=UTC) - timedelta(days=lookback_days)
    parsed_posts: list[dict[str, Any]] = []
    seen_external_ids: set[str] = set()
    reel_count = 0

    for item in raw_items:
        external_id = _first_non_empty(item, ["id", "shortCode", "code", "postId"])

        if external_id is None:
            continue

        external_id = str(external_id)

        if external_id in seen_external_ids:
            continue

        posted_at = _parse_posted_at(
            _first_non_empty(item, ["timestamp", "takenAt", "takenAtTimestamp", "postedAt"]),
        )

        if posted_at is not None and posted_at < cutoff:
            continue

        post_url = _first_non_empty(item, ["url", "postUrl", "inputUrl"])
        if post_url is None:
            continue

        is_reel = _is_reel_item(item)
        if is_reel:
            reel_count += 1

        caption = sanitize_optional_str(
            _first_non_empty(item, ["caption", "text", "description"]),
        )
        transcript = _first_non_empty(item, ["transcript", "transcription", "videoTranscript"])
        transcript_text = sanitize_text(transcript.strip()) if isinstance(transcript, str) else None
        transcription_status = _resolve_transcription_status(
            is_reel=is_reel,
            transcript=transcript_text,
        )

        parsed_posts.append(
            {
                "external_id": external_id,
                "platform": "instagram",
                "content_type": _resolve_content_type(item, is_reel=is_reel),
                "posted_at": posted_at.isoformat() if posted_at else None,
                "likes": _first_non_empty(item, ["likesCount", "likes", "likeCount"]),
                "views": _first_non_empty(
                    item,
                    ["videoViewCount", "viewsCount", "views", "playCount"],
                ),
                "shares": _first_non_empty(item, ["sharesCount", "shares", "shareCount"]),
                "comments_count": _first_non_empty(
                    item,
                    ["commentsCount", "comments", "commentCount"],
                ),
                "caption": caption,
                "post_url": str(post_url),
                "transcript": transcript_text if transcription_status == "completed" else None,
                "transcript_source": (
                    "apify_instagram_post_scraper" if transcription_status == "completed" else None
                ),
                "transcription_status": transcription_status,
                "raw_payload": sanitize_json_value(item),
            },
        )
        seen_external_ids.add(external_id)

    logger.info(
        "Parsed Instagram posts from Apify payload",
        extra={
            "raw_item_count": len(raw_items),
            "parsed_post_count": len(parsed_posts),
            "parsed_reel_count": reel_count,
            "lookback_days": lookback_days,
        },
    )

    return parsed_posts


def parse_instagram_reels(
    raw_items: list[dict[str, Any]],
    *,
    lookback_days: int,
) -> list[dict[str, Any]]:
    posts = parse_instagram_posts(raw_items, lookback_days=lookback_days)
    reels = [post for post in posts if post["content_type"] == "reel"]

    for reel in reels:
        reel["reel_url"] = reel["post_url"]

    return reels
