import logging
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from app.services.text_sanitize import sanitize_json_value, sanitize_optional_str

logger = logging.getLogger(__name__)


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


def _as_non_negative_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, float) and value >= 0 and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _resolve_likes(item: dict[str, Any]) -> int | None:
    reactions = item.get("reactions")
    if isinstance(reactions, dict):
        total = reactions.get("total") or reactions.get("count")
        parsed = _as_non_negative_int(total)
        if parsed is not None:
            return parsed

    return _as_non_negative_int(
        _first_non_empty(
            item,
            [
                "numLikes",
                "likeCount",
                "likes",
                "likesCount",
                "totalReactionCount",
                "reactionCount",
            ],
        ),
    )


def parse_linkedin_posts(raw_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    parsed_posts: list[dict[str, Any]] = []
    seen_external_ids: set[str] = set()

    for item in raw_items:
        if not isinstance(item, dict):
            continue

        error = item.get("error") or item.get("errMsg")
        if isinstance(error, str) and error.strip():
            logger.warning(
                "Skipping LinkedIn Apify error item",
                extra={"error": error.strip()},
            )
            continue

        external_id = _first_non_empty(
            item,
            ["urn", "postUrn", "activityUrn", "id", "postId", "shareUrn"],
        )
        post_url = _first_non_empty(item, ["postUrl", "url", "shareUrl", "link"])

        if external_id is None and isinstance(post_url, str):
            path = urlparse(post_url).path.rstrip("/")
            external_id = path.split("/")[-1] if path else None

        if external_id is None:
            continue

        external_id = str(external_id)
        if external_id in seen_external_ids:
            continue

        caption = sanitize_optional_str(
            _first_non_empty(
                item,
                ["text", "commentary", "content", "postText", "caption", "description"],
            ),
        )
        posted_at = _parse_posted_at(
            _first_non_empty(
                item,
                ["postedAt", "postedAtTimestamp", "publishedAt", "createdAt", "timestamp"],
            ),
        )

        author = item.get("author") if isinstance(item.get("author"), dict) else {}
        author_name = sanitize_optional_str(
            _first_non_empty(
                item if not author else author,
                ["authorName", "name", "fullName"],
            ),
        )
        author_headline = sanitize_optional_str(
            _first_non_empty(
                item if not author else author,
                ["authorHeadline", "headline", "title"],
            ),
        )

        parsed_posts.append(
            {
                "external_id": external_id,
                "post_url": str(post_url) if isinstance(post_url, str) else None,
                "posted_at": posted_at.isoformat() if posted_at else None,
                "caption": caption,
                "likes": _resolve_likes(item),
                "comments_count": _as_non_negative_int(
                    _first_non_empty(
                        item,
                        ["numComments", "commentCount", "commentsCount", "comments"],
                    ),
                ),
                "shares": _as_non_negative_int(
                    _first_non_empty(
                        item,
                        ["numShares", "shareCount", "reposts", "repostCount", "shares"],
                    ),
                ),
                "author_name": author_name,
                "author_headline": author_headline,
                "raw_payload": sanitize_json_value(item),
            },
        )
        seen_external_ids.add(external_id)

    logger.info(
        "Parsed LinkedIn posts from Apify payload",
        extra={
            "raw_item_count": len(raw_items),
            "parsed_post_count": len(parsed_posts),
        },
    )

    return parsed_posts


from app.services.llm_content_selection import select_content_for_llm


def select_linkedin_content_for_llm(
    content_items: list[dict[str, Any]],
    *,
    max_items: int = 20,
    caption_max_chars: int = 600,
) -> list[dict[str, Any]]:
    """Shrink LinkedIn payloads for LLM prompts."""
    return select_content_for_llm(
        content_items,
        max_items=max_items,
        caption_max_chars=caption_max_chars,
    )
