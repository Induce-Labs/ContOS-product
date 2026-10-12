import logging
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlparse

from app.services.llm_content_selection import select_content_for_llm
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


def _author_dict(item: dict[str, Any]) -> dict[str, Any]:
    author = item.get("author")
    if isinstance(author, dict):
        return author
    user = item.get("user")
    if isinstance(user, dict):
        return user
    return {}


def parse_twitter_tweets(
    raw_items: list[dict[str, Any]],
    *,
    lookback_days: int = 7,
) -> list[dict[str, Any]]:
    """Normalize Apify X tweet rows. No engagement metrics are persisted as columns."""
    parsed_tweets: list[dict[str, Any]] = []
    seen_external_ids: set[str] = set()
    cutoff = datetime.now(tz=UTC) - timedelta(days=max(1, lookback_days))

    for item in raw_items:
        if not isinstance(item, dict):
            continue

        result_type = item.get("resultType")
        if isinstance(result_type, str) and result_type.strip().lower() == "diagnostic":
            logger.warning(
                "Skipping Twitter Apify diagnostic item",
                extra={
                    "diagnostic_status": item.get("status"),
                    "diagnostic_detail": item.get("message"),
                },
            )
            continue

        error = item.get("error") or item.get("errMsg")
        if isinstance(error, str) and error.strip():
            logger.warning(
                "Skipping Twitter Apify error item",
                extra={"error": error.strip()},
            )
            continue

        # Skip non-tweet row types when present (users, articles, engagement lists).
        if isinstance(result_type, str):
            normalized_type = result_type.strip().lower()
            if normalized_type in {"user", "article", "engagement"}:
                continue

        external_id = _first_non_empty(
            item,
            ["id", "tweetId", "tweet_id", "id_str", "rest_id"],
        )
        post_url = _first_non_empty(
            item,
            ["tweetUrl", "url", "twitterUrl", "permanentUrl", "link"],
        )

        if external_id is None and isinstance(post_url, str):
            path = urlparse(post_url).path.rstrip("/")
            # /username/status/123456
            parts = [p for p in path.split("/") if p]
            if len(parts) >= 3 and parts[-2].lower() == "status":
                external_id = parts[-1]
            elif parts:
                external_id = parts[-1]

        if external_id is None:
            continue

        external_id = str(external_id)
        if external_id in seen_external_ids:
            continue

        posted_at = _parse_posted_at(
            _first_non_empty(
                item,
                [
                    "createdAt",
                    "created_at",
                    "postedAt",
                    "timestamp",
                    "date",
                    "time",
                ],
            ),
        )
        if posted_at is not None and posted_at < cutoff:
            continue

        caption = sanitize_optional_str(
            _first_non_empty(
                item,
                ["text", "fullText", "full_text", "caption", "content", "tweetText"],
            ),
        )

        author = _author_dict(item)
        author_source = author if author else item
        author_name = sanitize_optional_str(
            _first_non_empty(
                author_source,
                ["authorName", "name", "displayName", "display_name"],
            ),
        )
        author_username = sanitize_optional_str(
            _first_non_empty(
                author_source,
                [
                    "authorUsername",
                    "username",
                    "screen_name",
                    "screenName",
                    "userName",
                    "handle",
                ],
            ),
        )
        if isinstance(author_username, str):
            author_username = author_username.lstrip("@")

        author_followers = _as_non_negative_int(
            _first_non_empty(
                author_source,
                [
                    "authorFollowers",
                    "followers",
                    "followersCount",
                    "followers_count",
                    "followersCount",
                ],
            ),
        )
        author_description = sanitize_optional_str(
            _first_non_empty(
                author_source,
                [
                    "authorDescription",
                    "description",
                    "bio",
                    "profile_bio",
                    "profileBio",
                ],
            ),
        )

        parsed_tweets.append(
            {
                "external_id": external_id,
                "post_url": str(post_url) if isinstance(post_url, str) else None,
                "posted_at": posted_at.isoformat() if posted_at else None,
                "caption": caption,
                "author_name": author_name,
                "author_username": author_username,
                "author_followers": author_followers,
                "author_description": author_description,
                "raw_payload": sanitize_json_value(item),
            },
        )
        seen_external_ids.add(external_id)

    logger.info(
        "Parsed Twitter tweets from Apify payload",
        extra={
            "raw_item_count": len(raw_items),
            "parsed_tweet_count": len(parsed_tweets),
            "lookback_days": lookback_days,
        },
    )

    return parsed_tweets


def select_twitter_content_for_llm(
    content_items: list[dict[str, Any]],
    *,
    max_items: int = 20,
    caption_max_chars: int = 600,
) -> list[dict[str, Any]]:
    """Shrink Twitter payloads for LLM prompts."""
    return select_content_for_llm(
        content_items,
        max_items=max_items,
        caption_max_chars=caption_max_chars,
    )


def extract_twitter_handle(handle_or_url: str) -> str:
    """Extract a bare Twitter/X username from a URL or @handle."""
    value = handle_or_url.strip()
    if not value:
        raise ValueError("Twitter handle or URL is required.")

    lowered = value.lower()
    if "linkedin.com" in lowered or "instagram.com" in lowered:
        raise ValueError(
            f"Refusing to parse a non-Twitter URL as a Twitter handle: {handle_or_url}",
        )

    if "twitter.com" in lowered or "x.com" in lowered:
        path = urlparse(value if "://" in value else f"https://{value}").path
        parts = [p for p in path.split("/") if p]
        if not parts:
            raise ValueError(f"Could not extract Twitter handle from URL: {handle_or_url}")
        reserved = {
            "home",
            "explore",
            "search",
            "i",
            "intent",
            "settings",
            "messages",
            "notifications",
            "compose",
        }
        handle = parts[0]
        if handle.lower() in reserved:
            raise ValueError(f"Could not extract Twitter handle from URL: {handle_or_url}")
        return handle.lstrip("@")

    return value.lstrip("@").split("/")[0].split("?")[0]
