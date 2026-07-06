import logging

from datetime import UTC, datetime

from typing import Any

from uuid import UUID



from app.clients.apify_client import ApifyClient

from app.clients.llm_client import LlmClient

from app.clients.supabase_repo import SupabaseRepository

from app.config import Settings, get_settings

from app.errors import ConfigurationError, PipelineError

from app.services.instagram_parser import parse_instagram_posts



logger = logging.getLogger(__name__)





def run_pipeline_batch(project_id: UUID, competitor_ids: list[UUID]) -> None:

    settings = get_settings()



    try:

        repository = SupabaseRepository(settings)

        apify_client = ApifyClient(settings)

        llm_client = LlmClient(settings)

    except ConfigurationError as error:

        logger.error(

            "Pipeline batch aborted due to configuration error",

            extra={"project_id": str(project_id), "error": str(error)},

        )

        return



    try:

        competitors = repository.get_competitors_for_project(project_id, competitor_ids)

    except Exception as error:

        logger.error(

            "Failed to load competitors for pipeline batch",

            extra={"project_id": str(project_id), "error": str(error)},

        )

        return



    for competitor in competitors:

        competitor_id = UUID(competitor["id"])

        try:

            run_competitor_pipeline(

                project_id=project_id,

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

                    "project_id": str(project_id),

                    "competitor_id": str(competitor_id),

                    "error": str(error),

                },

            )

            repository.update_competitor_status(

                competitor_id,

                scrape_status="failed",

                pipeline_step="failed",

                error_message=str(error),

            )



    try:

        repository.refresh_project_status(project_id)

    except Exception as error:

        logger.error(

            "Failed to refresh project status after pipeline batch",

            extra={"project_id": str(project_id), "error": str(error)},

        )





def run_competitor_pipeline(

    *,

    project_id: UUID,

    competitor: dict[str, Any],

    settings: Settings,

    repository: SupabaseRepository,

    apify_client: ApifyClient,

    llm_client: LlmClient,

) -> None:

    competitor_id = UUID(competitor["id"])

    profile_url = competitor["handle_or_url"]



    logger.info(

        "[PIPELINE] Step 1/3 SCRAPE started for competitor %s (%s)",

        competitor_id,

        profile_url,

    )



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



    pending_rows = repository.get_posts_pending_transcription(competitor_id)

    pending_urls = [str(row["post_url"]) for row in pending_rows if row.get("post_url")]



    logger.info(

        "[PIPELINE] Step 2/3 TRANSCRIBE — %s reel URLs pending from scraped_content",

        len(pending_urls),

        extra={

            "competitor_id": str(competitor_id),

            "pending_count": len(pending_urls),

        },

    )



    transcript_updates: list[dict[str, Any]] = []



    if pending_rows:

        repository.mark_transcription_in_progress([str(row["id"]) for row in pending_rows])

        transcript_map = apify_client.transcribe_reel_urls(pending_urls)



        logger.info(

            "[PIPELINE] Step 2/3 TRANSCRIBE — transcriber returned %s transcripts for %s URLs",

            len(transcript_map),

            len(pending_urls),

            extra={

                "competitor_id": str(competitor_id),

                "urls_sent": len(pending_urls),

                "transcripts_received": len(transcript_map),

            },

        )



        for row in pending_rows:

            post_url = str(row["post_url"])

            transcript = transcript_map.get(post_url)



            if transcript:

                transcript_updates.append(

                    {

                        "post_url": post_url,

                        "transcript": transcript,

                        "transcript_source": settings.apify_transcriber_actor_id,

                        "transcription_status": "completed",

                    },

                )

            else:

                logger.warning(

                    "[PIPELINE] Step 2/3 TRANSCRIBE — no transcript returned for %s",

                    post_url,

                    extra={"competitor_id": str(competitor_id), "post_url": post_url},

                )

                transcript_updates.append(

                    {

                        "post_url": post_url,

                        "transcript": None,

                        "transcript_source": None,

                        "transcription_status": "failed",

                    },

                )



        updated_count = repository.update_scraped_content_transcripts(

            competitor_id,

            transcript_updates,

        )



        logger.info(

            "[PIPELINE] Step 2/3 TRANSCRIBE complete — updated %s rows in scraped_content",

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



    logger.info(

        "[PIPELINE] Step 3/3 ANALYZE started for competitor %s",

        competitor_id,

    )



    repository.update_competitor_status(

        competitor_id,

        scrape_status="in_progress",

        pipeline_step="analyzing",

        error_message=None,

    )



    content_for_summary = repository.get_content_for_summary(competitor_id)

    if not content_for_summary:
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

    summary_payload, model_used = llm_client.summarize_competitor_content(
        competitor_handle=profile_url,
        content_items=summary_content,
    )



    repository.replace_content_summary(

        competitor_id=competitor_id,

        project_id=project_id,

        summary=summary_payload.model_dump(),

        model_used=model_used,

    )



    repository.update_competitor_status(

        competitor_id,

        scrape_status="completed",

        pipeline_step="done",

        error_message=None,

        last_scraped_at=datetime.now(tz=UTC),

    )



    logger.info(

        "[PIPELINE] Step 3/3 ANALYZE complete — competitor pipeline done",

        extra={

            "project_id": str(project_id),

            "competitor_id": str(competitor_id),

            "content_count": len(content_for_summary),

            "model_used": model_used,

        },

    )


