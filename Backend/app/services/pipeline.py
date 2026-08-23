import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID
from app.clients.apify_client import ApifyClient
from app.clients.llm_client import LlmClient
from app.clients.supabase_repo import SupabaseRepository
from app.config import Settings, get_settings
from app.errors import ConfigurationError, PipelineError
from app.services.engagement_metrics import enrich_competitor_summary
from app.services.instagram_parser import parse_instagram_posts
from app.services.linkedin_parser import parse_linkedin_posts
from app.services.llm_content_selection import select_content_for_llm
from app.services.text_sanitize import sanitize_text

logger = logging.getLogger(__name__)


def run_pipeline_batch(avatar_id: UUID, competitor_ids: list[UUID]) -> None:
    settings = get_settings()
    try:
        repository = SupabaseRepository(settings)
        apify_client = ApifyClient(settings)
        llm_client = LlmClient(settings)
    except ConfigurationError as error:
        logger.error(
            "Pipeline batch aborted due to configuration error",
            extra={"avatar_id": str(avatar_id), "error": str(error)},
        )
        return
    try:
        competitors = repository.get_competitors_for_avatar(avatar_id, competitor_ids)
    except Exception as error:
        logger.error(
            "Failed to load competitors for pipeline batch",
            extra={"avatar_id": str(avatar_id), "error": str(error)},
        )
        return
    for competitor in competitors:
        competitor_id = UUID(competitor["id"])
        platform = resolve_competitor_platform(competitor)
        try:
            if platform == "linkedin":
                logger.info(
                    "[PIPELINE] Dispatching LinkedIn pipeline (scrape→analyze)",
                    extra={
                        "avatar_id": str(avatar_id),
                        "competitor_id": str(competitor_id),
                        "platform": platform,
                        "handle_or_url": competitor.get("handle_or_url"),
                    },
                )
                run_linkedin_competitor_pipeline(
                    avatar_id=avatar_id,
                    competitor=competitor,
                    settings=settings,
                    repository=repository,
                    apify_client=apify_client,
                    llm_client=llm_client,
                )
            else:
                logger.info(
                    "[PIPELINE] Dispatching Instagram pipeline (scrape→transcribe→analyze)",
                    extra={
                        "avatar_id": str(avatar_id),
                        "competitor_id": str(competitor_id),
                        "platform": platform,
                        "handle_or_url": competitor.get("handle_or_url"),
                    },
                )
                run_instagram_competitor_pipeline(
                    avatar_id=avatar_id,
                    competitor=competitor,
                    settings=settings,
                    repository=repository,
                    apify_client=apify_client,
                    llm_client=llm_client,
                )
        except Exception as error:
            logger.exception(
                "Competitor pipeline failed",
                extra={
                    "avatar_id": str(avatar_id),
                    "competitor_id": str(competitor_id),
                    "platform": platform,
                    "error": str(error),
                },
            )
            repository.clear_cancel_requested(competitor_id)
            repository.update_competitor_status(
                competitor_id,
                scrape_status="failed",
                pipeline_step="failed",
                error_message=str(error),
            )
    try:
        repository.refresh_avatar_status(avatar_id)
    except Exception as error:
        logger.error(
            "Failed to refresh avatar status after pipeline batch",
            extra={"avatar_id": str(avatar_id), "error": str(error)},
        )


def resolve_competitor_platform(competitor: dict[str, Any]) -> str:
    """Resolve scrape platform from DB field, with URL fallback for safety."""
    profile_url = str(competitor.get("handle_or_url") or "").strip().lower()
    platform = str(competitor.get("platform") or "").strip().lower()
    if "linkedin.com" in profile_url or platform == "linkedin":
        return "linkedin"
    if "instagram.com" in profile_url or platform == "instagram":
        return "instagram"
    if platform in {"twitter", "reddit"}:
        return platform
    return platform or "instagram"


def run_competitor_pipeline(
    *,
    avatar_id: UUID,
    competitor: dict[str, Any],
    settings: Settings,
    repository: SupabaseRepository,
    apify_client: ApifyClient,
    llm_client: LlmClient,
) -> None:
    """Dispatch helper kept for tests/callers; prefer batch-level routing."""
    platform = resolve_competitor_platform(competitor)
    if platform == "linkedin":
        run_linkedin_competitor_pipeline(
            avatar_id=avatar_id,
            competitor=competitor,
            settings=settings,
            repository=repository,
            apify_client=apify_client,
            llm_client=llm_client,
        )
        return
    run_instagram_competitor_pipeline(
        avatar_id=avatar_id,
        competitor=competitor,
        settings=settings,
        repository=repository,
        apify_client=apify_client,
        llm_client=llm_client,
    )


def run_instagram_competitor_pipeline(
    *,
    avatar_id: UUID,
    competitor: dict[str, Any],
    settings: Settings,
    repository: SupabaseRepository,
    apify_client: ApifyClient,
    llm_client: LlmClient,
) -> None:
    competitor_id = UUID(competitor["id"])
    profile_url = competitor["handle_or_url"]
    if resolve_competitor_platform(competitor) == "linkedin":
        raise PipelineError(
            "LinkedIn competitors must use the LinkedIn pipeline "
            f"(datadoping/linkedin-profile-posts-scraper), not Instagram. "
            f"Refusing profile: {profile_url}",
        )

    logger.info(
        "[PIPELINE] Step 1/3 SCRAPE started for competitor %s (%s)",
        competitor_id,
        profile_url,
    )
    repository.clear_cancel_requested(competitor_id)
    repository.update_competitor_status(
        competitor_id,
        scrape_status="in_progress",
        pipeline_step="scraping",
        error_message=None,
    )

    raw_items = apify_client.scrape_instagram_profile(profile_url)
    parsed_posts = parse_instagram_posts(
        raw_items,
        lookback_days=settings.scrape_lookback_days,
    )

    if not parsed_posts:
        if repository.is_cancel_requested(competitor_id):
            _mark_stopped_without_content(repository, competitor_id)
            return
        raise PipelineError(
            f"No Instagram posts found for {profile_url} within the last "
            f"{settings.scrape_lookback_days} days.",
        )

    reel_count = sum(1 for post in parsed_posts if post["content_type"] == "reel")
    other_count = len(parsed_posts) - reel_count
    scraped_rows = [
        {
            "competitor_id": str(competitor_id),
            "platform": post["platform"],
            "content_type": post["content_type"],
            "external_id": post["external_id"],
            "posted_at": post["posted_at"],
            "likes": post["likes"],
            "views": post["views"],
            "shares": post["shares"],
            "comments_count": post["comments_count"],
            "caption": post["caption"],
            "post_url": post["post_url"],
            "transcript": post["transcript"],
            "transcript_source": post["transcript_source"],
            "transcription_status": post["transcription_status"],
            "raw_payload": post["raw_payload"],
        }
        for post in parsed_posts
    ]
    repository.upsert_scraped_content(scraped_rows)
    logger.info(
        "[PIPELINE] Step 1/3 SCRAPE complete — stored %s posts (%s reels, %s other)",
        len(parsed_posts),
        reel_count,
        other_count,
        extra={
            "competitor_id": str(competitor_id),
            "total_posts": len(parsed_posts),
            "reel_count": reel_count,
            "other_count": other_count,
        },
    )

    # Stop after scrape: keep stored posts and jump straight to summarize.
    if repository.is_cancel_requested(competitor_id):
        logger.info(
            "[PIPELINE] Stop requested after scrape — skipping transcription, summarizing stored posts",
            extra={"competitor_id": str(competitor_id), "stored_posts": len(parsed_posts)},
        )
        _analyze_instagram_competitor(
            avatar_id=avatar_id,
            competitor_id=competitor_id,
            profile_url=profile_url,
            repository=repository,
            llm_client=llm_client,
            stopped_early=True,
        )
        return

    logger.info(
        "[PIPELINE] Step 2/3 TRANSCRIBE started for competitor %s",
        competitor_id,
    )
    repository.update_competitor_status(
        competitor_id,
        scrape_status="in_progress",
        pipeline_step="transcribing",
        error_message=None,
    )

    if repository.is_cancel_requested(competitor_id):
        logger.info(
            "[PIPELINE] Stop requested before transcription — summarizing scraped posts as-is",
            extra={"competitor_id": str(competitor_id)},
        )
        _analyze_instagram_competitor(
            avatar_id=avatar_id,
            competitor_id=competitor_id,
            profile_url=profile_url,
            repository=repository,
            llm_client=llm_client,
            stopped_early=True,
        )
        return

    pending_rows = repository.get_posts_pending_transcription(competitor_id)
    pending_urls = [str(row["post_url"]) for row in pending_rows if row.get("post_url")]
    logger.info(
        "[PIPELINE] Step 2/3 TRANSCRIBE — %s reel URLs pending from instagram_scraped_content",
        len(pending_urls),
        extra={
            "competitor_id": str(competitor_id),
            "pending_count": len(pending_urls),
        },
    )
    transcript_updates: list[dict[str, Any]] = []
    if pending_rows:
        repository.mark_transcription_in_progress([str(row["id"]) for row in pending_rows])
        transcript_results = apify_client.transcribe_reel_urls(pending_urls)
        logger.info(
            "[PIPELINE] Step 2/3 TRANSCRIBE — transcriber returned %s transcripts for %s URLs",
            sum(1 for result in transcript_results.values() if result.succeeded),
            len(pending_urls),
            extra={
                "competitor_id": str(competitor_id),
                "urls_sent": len(pending_urls),
                "transcripts_received": sum(
                    1 for result in transcript_results.values() if result.succeeded
                ),
            },
        )
        for row in pending_rows:
            post_url = str(row["post_url"])
            transcription_result = transcript_results.get(post_url)
            if transcription_result and transcription_result.succeeded:
                transcript_updates.append(
                    {
                        "post_url": post_url,
                        "transcript": sanitize_text(transcription_result.transcript),
                        "transcript_source": settings.apify_transcriber_actor_id,
                        "transcription_status": "completed",
                        "transcription_error": None,
                    },
                )
            else:
                error_message = (
                    transcription_result.error_message
                    if transcription_result and transcription_result.error_message
                    else "Transcriber returned no transcript for this reel URL."
                )
                logger.warning(
                    "[PIPELINE] Step 2/3 TRANSCRIBE — no transcript returned for %s",
                    post_url,
                    extra={
                        "competitor_id": str(competitor_id),
                        "post_url": post_url,
                        "transcription_error": error_message,
                    },
                )
                transcript_updates.append(
                    {
                        "post_url": post_url,
                        "transcript": None,
                        "transcript_source": None,
                        "transcription_status": "failed",
                        "transcription_error": error_message,
                    },
                )
        updated_count = repository.update_scraped_content_transcripts(
            competitor_id,
            transcript_updates,
        )
        logger.info(
            "[PIPELINE] Step 2/3 TRANSCRIBE complete — updated %s rows in instagram_scraped_content",
            updated_count,
            extra={
                "competitor_id": str(competitor_id),
                "rows_updated": updated_count,
            },
        )
    else:
        logger.info(
            "[PIPELINE] Step 2/3 TRANSCRIBE skipped — no pending reel URLs",
            extra={"competitor_id": str(competitor_id)},
        )

    stopped_early = repository.is_cancel_requested(competitor_id)
    if stopped_early:
        logger.info(
            "[PIPELINE] Stop requested after transcription — summarizing available content",
            extra={"competitor_id": str(competitor_id)},
        )

    _analyze_instagram_competitor(
        avatar_id=avatar_id,
        competitor_id=competitor_id,
        profile_url=profile_url,
        repository=repository,
        llm_client=llm_client,
        stopped_early=stopped_early,
    )


def _analyze_instagram_competitor(
    *,
    avatar_id: UUID,
    competitor_id: UUID,
    profile_url: str,
    repository: SupabaseRepository,
    llm_client: LlmClient,
    stopped_early: bool = False,
) -> None:
    logger.info(
        "[PIPELINE] Step 3/3 ANALYZE started for competitor %s%s",
        competitor_id,
        " (after stop)" if stopped_early else "",
    )
    repository.update_competitor_status(
        competitor_id,
        scrape_status="in_progress",
        pipeline_step="analyzing",
        error_message=None,
    )

    content_for_summary = repository.get_content_for_summary(competitor_id)
    if not content_for_summary:
        if stopped_early or repository.is_cancel_requested(competitor_id):
            _mark_stopped_without_content(repository, competitor_id)
            return
        raise PipelineError(
            f"No scraped content available for summarization for competitor {competitor_id}.",
        )

    reel_count_summary = sum(
        1 for item in content_for_summary if item.get("content_type") == "reel"
    )
    post_count_summary = sum(
        1 for item in content_for_summary if item.get("content_type") == "post"
    )
    carousel_count_summary = sum(
        1 for item in content_for_summary if item.get("content_type") == "carousel"
    )
    reels_with_transcript = sum(
        1
        for item in content_for_summary
        if item.get("content_type") == "reel"
        and isinstance(item.get("transcript"), str)
        and item["transcript"].strip()
    )
    logger.info(
        "[PIPELINE] Step 3/3 ANALYZE — summarizing %s content items "
        "(%s reels [%s with transcript], %s posts, %s carousels)",
        len(content_for_summary),
        reel_count_summary,
        reels_with_transcript,
        post_count_summary,
        carousel_count_summary,
        extra={
            "competitor_id": str(competitor_id),
            "total_content": len(content_for_summary),
            "reel_count": reel_count_summary,
            "post_count": post_count_summary,
            "carousel_count": carousel_count_summary,
            "reels_with_transcript": reels_with_transcript,
            "stopped_early": stopped_early,
        },
    )

    summary_content = [
        {
            "external_id": item["external_id"],
            "content_type": item.get("content_type"),
            "caption": item.get("caption"),
            "transcript": item.get("transcript"),
            "likes": item.get("likes"),
            "views": item.get("views"),
            "shares": item.get("shares"),
            "comments_count": item.get("comments_count"),
            "posted_at": item.get("posted_at"),
        }
        for item in content_for_summary
    ]
    settings = get_settings()
    llm_content = select_content_for_llm(
        summary_content,
        max_items=settings.llm_max_content_items,
    )
    logger.info(
        "[PIPELINE] Step 3/3 ANALYZE — sending %s of %s content items to LLM",
        len(llm_content),
        len(summary_content),
        extra={
            "competitor_id": str(competitor_id),
            "llm_item_count": len(llm_content),
            "scraped_item_count": len(summary_content),
            "stopped_early": stopped_early,
        },
    )
    summary_payload, model_used = llm_client.summarize_competitor_content(
        competitor_handle=profile_url,
        content_items=llm_content,
    )
    summary_payload = enrich_competitor_summary(summary_payload, summary_content)
    repository.replace_content_summary(
        competitor_id=competitor_id,
        avatar_id=avatar_id,
        summary=summary_payload.model_dump(),
        model_used=model_used,
    )
    repository.clear_cancel_requested(competitor_id)
    repository.update_competitor_status(
        competitor_id,
        scrape_status="completed",
        pipeline_step="done",
        error_message=(
            "Research stopped early; summary is based on content scraped before stop."
            if stopped_early
            else None
        ),
        last_scraped_at=datetime.now(tz=UTC),
    )
    logger.info(
        "[PIPELINE] Step 3/3 ANALYZE complete — competitor pipeline done",
        extra={
            "avatar_id": str(avatar_id),
            "competitor_id": str(competitor_id),
            "content_count": len(content_for_summary),
            "model_used": model_used,
            "stopped_early": stopped_early,
        },
    )


def run_linkedin_competitor_pipeline(
    *,
    avatar_id: UUID,
    competitor: dict[str, Any],
    settings: Settings,
    repository: SupabaseRepository,
    apify_client: ApifyClient,
    llm_client: LlmClient,
) -> None:
    competitor_id = UUID(competitor["id"])
    profile_url = competitor["handle_or_url"]
    logger.info(
        "[PIPELINE] LinkedIn Step 1/2 SCRAPE started for competitor %s (%s)",
        competitor_id,
        profile_url,
    )
    repository.clear_cancel_requested(competitor_id)
    repository.update_competitor_status(
        competitor_id,
        scrape_status="in_progress",
        pipeline_step="scraping",
        error_message=None,
    )

    raw_items = apify_client.scrape_linkedin_profile(profile_url)
    parsed_posts = parse_linkedin_posts(raw_items)
    if not parsed_posts:
        if repository.is_cancel_requested(competitor_id):
            _mark_stopped_without_content(repository, competitor_id)
            return
        raise PipelineError(
            f"No LinkedIn posts found for {profile_url}.",
        )

    scraped_rows = [
        {
            "competitor_id": str(competitor_id),
            "external_id": post["external_id"],
            "post_url": post["post_url"],
            "posted_at": post["posted_at"],
            "caption": post["caption"],
            "likes": post["likes"],
            "comments_count": post["comments_count"],
            "shares": post["shares"],
            "author_name": post["author_name"],
            "author_headline": post["author_headline"],
            "raw_payload": post["raw_payload"],
        }
        for post in parsed_posts
    ]
    repository.upsert_linkedin_scraped_content(scraped_rows)
    logger.info(
        "[PIPELINE] LinkedIn Step 1/2 SCRAPE complete — stored %s posts",
        len(parsed_posts),
        extra={
            "competitor_id": str(competitor_id),
            "total_posts": len(parsed_posts),
        },
    )

    stopped_early = repository.is_cancel_requested(competitor_id)
    if stopped_early:
        logger.info(
            "[PIPELINE] Stop requested after LinkedIn scrape — summarizing stored posts",
            extra={"competitor_id": str(competitor_id), "stored_posts": len(parsed_posts)},
        )

    _analyze_linkedin_competitor(
        avatar_id=avatar_id,
        competitor_id=competitor_id,
        profile_url=profile_url,
        repository=repository,
        llm_client=llm_client,
        stopped_early=stopped_early,
    )


def _analyze_linkedin_competitor(
    *,
    avatar_id: UUID,
    competitor_id: UUID,
    profile_url: str,
    repository: SupabaseRepository,
    llm_client: LlmClient,
    stopped_early: bool = False,
) -> None:
    logger.info(
        "[PIPELINE] LinkedIn Step 2/2 ANALYZE started for competitor %s%s",
        competitor_id,
        " (after stop)" if stopped_early else "",
    )
    repository.update_competitor_status(
        competitor_id,
        scrape_status="in_progress",
        pipeline_step="analyzing",
        error_message=None,
    )

    content_for_summary = repository.get_linkedin_content_for_summary(competitor_id)
    if not content_for_summary:
        if stopped_early or repository.is_cancel_requested(competitor_id):
            _mark_stopped_without_content(repository, competitor_id)
            return
        raise PipelineError(
            f"No LinkedIn scraped content available for summarization for competitor {competitor_id}.",
        )

    summary_content = [
        {
            "external_id": item["external_id"],
            "content_type": "post",
            "caption": item.get("caption"),
            "likes": item.get("likes"),
            "views": None,
            "shares": item.get("shares"),
            "comments_count": item.get("comments_count"),
            "posted_at": item.get("posted_at"),
            "author_name": item.get("author_name"),
            "author_headline": item.get("author_headline"),
        }
        for item in content_for_summary
    ]
    llm_content = select_content_for_llm(
        summary_content,
        max_items=get_settings().llm_max_content_items,
    )
    logger.info(
        "[PIPELINE] LinkedIn Step 2/2 ANALYZE — summarizing %s of %s posts for LLM",
        len(llm_content),
        len(summary_content),
        extra={
            "competitor_id": str(competitor_id),
            "llm_item_count": len(llm_content),
            "scraped_item_count": len(summary_content),
            "stopped_early": stopped_early,
        },
    )
    summary_payload, model_used = llm_client.summarize_competitor_content(
        competitor_handle=profile_url,
        content_items=llm_content,
        platform="linkedin",
    )
    summary_payload = enrich_competitor_summary(summary_payload, summary_content)
    repository.replace_linkedin_content_summary(
        competitor_id=competitor_id,
        avatar_id=avatar_id,
        summary=summary_payload.model_dump(),
        model_used=model_used,
    )
    repository.clear_cancel_requested(competitor_id)
    repository.update_competitor_status(
        competitor_id,
        scrape_status="completed",
        pipeline_step="done",
        error_message=(
            "Research stopped early; summary is based on content scraped before stop."
            if stopped_early
            else None
        ),
        last_scraped_at=datetime.now(tz=UTC),
    )
    logger.info(
        "[PIPELINE] LinkedIn Step 2/2 ANALYZE complete — competitor pipeline done",
        extra={
            "avatar_id": str(avatar_id),
            "competitor_id": str(competitor_id),
            "content_count": len(content_for_summary),
            "model_used": model_used,
            "stopped_early": stopped_early,
        },
    )


def _mark_stopped_without_content(
    repository: SupabaseRepository,
    competitor_id: UUID,
) -> None:
    repository.clear_cancel_requested(competitor_id)
    repository.update_competitor_status(
        competitor_id,
        scrape_status="failed",
        pipeline_step="failed",
        error_message="Stopped by user before any posts were saved.",
    )
    logger.info(
        "[PIPELINE] Stop finalized with no stored content",
        extra={"competitor_id": str(competitor_id)},
    )
