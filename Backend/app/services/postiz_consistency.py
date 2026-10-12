"""Monthly posting consistency derived from an avatar's Postiz history.

Postiz remains the source of truth. This module only buckets already-fetched
published roots into a local calendar month. It does not store streaks.
"""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.errors import PostizBadRequestError, PostizServiceError

_MONTH_PATTERN_YEAR = 4


@dataclass(frozen=True)
class ConsistencyDay:
    date: str
    posted: bool
    is_today: bool


@dataclass(frozen=True)
class ConsistencyMonth:
    avatar_id: str
    timezone: str
    month: str
    days_in_month: int
    connected: bool
    posted_days: int
    current_streak: int | None
    longest_streak: int
    total_published_posts: int
    linkedin_posted_days: int
    x_posted_days: int
    days: tuple[ConsistencyDay, ...]
    query_start: str | None = None
    query_end: str | None = None


def require_timezone(timezone: str) -> ZoneInfo:
    cleaned = timezone.strip()
    if not cleaned or len(cleaned) > 100:
        raise PostizBadRequestError(
            f"timezone {timezone!r} is not a valid IANA timezone.",
        )
    try:
        return ZoneInfo(cleaned)
    except ZoneInfoNotFoundError as error:
        raise PostizBadRequestError(
            f"timezone {cleaned!r} is not a valid IANA timezone.",
        ) from error


def require_month(month: str) -> tuple[int, int]:
    cleaned = month.strip()
    parts = cleaned.split("-")
    if len(parts) != 2 or len(parts[0]) != _MONTH_PATTERN_YEAR or len(parts[1]) != 2:
        raise PostizBadRequestError(f"month {month!r} must be YYYY-MM.")
    if not parts[0].isdigit() or not parts[1].isdigit():
        raise PostizBadRequestError(f"month {month!r} must be YYYY-MM.")
    year = int(parts[0])
    month_number = int(parts[1])
    if month_number < 1 or month_number > 12 or year < 1:
        raise PostizBadRequestError(f"month {month!r} must be YYYY-MM.")
    return year, month_number


def month_key(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def local_month_bounds(year: int, month: int, tz: ZoneInfo) -> tuple[datetime, datetime, int]:
    last_day = monthrange(year, month)[1]
    start = datetime(year, month, 1, 0, 0, 0, tzinfo=tz)
    end = datetime(year, month, last_day, 23, 59, 59, tzinfo=tz)
    return start, end, last_day


def empty_consistency(
    *,
    avatar_id: str,
    timezone: str,
    month: str,
    today: date,
    connected: bool,
) -> ConsistencyMonth:
    year, month_number = require_month(month)
    last_day = monthrange(year, month_number)[1]
    is_current = month_key(today) == f"{year:04d}-{month_number:02d}"
    days = tuple(
        ConsistencyDay(
            date=date(year, month_number, day_number).isoformat(),
            posted=False,
            is_today=is_current and date(year, month_number, day_number) == today,
        )
        for day_number in range(1, last_day + 1)
    )
    return ConsistencyMonth(
        avatar_id=avatar_id,
        timezone=timezone,
        month=f"{year:04d}-{month_number:02d}",
        days_in_month=last_day,
        connected=connected,
        posted_days=0,
        current_streak=0 if is_current else None,
        longest_streak=0,
        total_published_posts=0,
        linkedin_posted_days=0,
        x_posted_days=0,
        days=days,
    )


def aggregate_published_posts(
    raw_posts: list[Any],
    *,
    avatar_id: str,
    timezone_name: str,
    tz: ZoneInfo,
    year: int,
    month: int,
    today: date,
    linkedin_id: str | None,
    x_id: str | None,
    query_start: str,
    query_end: str,
) -> ConsistencyMonth:
    """Bucket published roots onto local calendar days inside one month."""
    allowed = {item for item in (linkedin_id, x_id) if item}
    last_day = monthrange(year, month)[1]
    month_start = date(year, month, 1)
    month_end = date(year, month, last_day)
    posted: set[date] = set()
    linkedin_days: set[date] = set()
    x_days: set[date] = set()
    total_published = 0

    for index, item in enumerate(raw_posts):
        qualified = _qualifying_local_day(
            item,
            index=index,
            tz=tz,
            allowed_ids=allowed,
            month_start=month_start,
            month_end=month_end,
        )
        if qualified is None:
            continue
        local_day, integration_id = qualified
        posted.add(local_day)
        total_published += 1
        if linkedin_id and integration_id == linkedin_id:
            linkedin_days.add(local_day)
        elif x_id and integration_id == x_id:
            x_days.add(local_day)

    is_current = month_start <= today <= month_end
    days = tuple(
        ConsistencyDay(
            date=date(year, month, day_number).isoformat(),
            posted=date(year, month, day_number) in posted,
            is_today=is_current and date(year, month, day_number) == today,
        )
        for day_number in range(1, last_day + 1)
    )
    return ConsistencyMonth(
        avatar_id=avatar_id,
        timezone=timezone_name,
        month=f"{year:04d}-{month:02d}",
        days_in_month=last_day,
        connected=True,
        posted_days=len(posted),
        current_streak=_current_streak(posted, today, month_start) if is_current else None,
        longest_streak=_longest_streak(posted, month_start, last_day),
        total_published_posts=total_published,
        linkedin_posted_days=len(linkedin_days),
        x_posted_days=len(x_days),
        days=days,
        query_start=query_start,
        query_end=query_end,
    )


def _current_streak(posted: set[date], today: date, month_start: date) -> int:
    """Live streak inside this month only.

    Today unposted keeps the streak when yesterday (still in this month) is posted.
    A posted last day of the previous month does not count.
    """
    cursor = today if today in posted else today - timedelta(days=1)
    if cursor < month_start or cursor not in posted:
        return 0
    count = 0
    while cursor >= month_start and cursor in posted:
        count += 1
        cursor -= timedelta(days=1)
    return count


def _longest_streak(posted: set[date], month_start: date, last_day: int) -> int:
    best = 0
    run = 0
    for offset in range(last_day):
        if month_start + timedelta(days=offset) in posted:
            run += 1
            best = max(best, run)
        else:
            run = 0
    return best


def _qualifying_local_day(
    item: Any,
    *,
    index: int,
    tz: ZoneInfo,
    allowed_ids: set[str],
    month_start: date,
    month_end: date,
) -> tuple[date, str] | None:
    if not isinstance(item, dict):
        return None
    if item.get("intervalInDays") is not None:
        return None
    parent_post_id = item.get("parentPostId")
    if isinstance(parent_post_id, str) and parent_post_id.strip():
        return None
    state = item.get("state")
    if not isinstance(state, str) or state.strip().upper() != "PUBLISHED":
        return None
    integration = item.get("integration")
    integration_id = integration.get("id") if isinstance(integration, dict) else None
    if not isinstance(integration_id, str) or integration_id.strip() not in allowed_ids:
        return None
    integration_id = integration_id.strip()
    local_day = _local_publish_day(item.get("publishDate"), tz=tz, index=index, post_id=item.get("id"))
    if local_day < month_start or local_day > month_end:
        return None
    return local_day, integration_id


def _local_publish_day(raw: Any, *, tz: ZoneInfo, index: int, post_id: Any) -> date:
    label = post_id if isinstance(post_id, str) and post_id.strip() else f"index {index}"
    if isinstance(raw, datetime):
        parsed = raw
    elif isinstance(raw, str) and raw.strip():
        text = raw.strip()
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError as error:
            raise PostizServiceError(
                f"Postiz post {label!r} is PUBLISHED but publishDate {raw!r} is not a valid datetime.",
            ) from error
    else:
        raise PostizServiceError(
            f"Postiz post {label!r} is PUBLISHED but publishDate {raw!r} is not a valid datetime.",
        )
    if parsed.tzinfo is None:
        raise PostizServiceError(
            f"Postiz post {label!r} is PUBLISHED but publishDate {raw!r} has no timezone offset.",
        )
    return parsed.astimezone(tz).date()
