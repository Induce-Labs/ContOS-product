import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import get_current_user_id
from app.constants import MAX_COMPETITORS_PER_AVATAR
from app.errors import ConfigurationError, RepositoryError
from app.services.pipeline import run_pipeline_batch

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/avatars", tags=["avatars"])


class ScrapeEnqueueRequest(BaseModel):
    competitor_ids: list[UUID] = Field(min_length=1)


class ScrapeEnqueueResponse(BaseModel):
    status: str
    competitor_ids: list[UUID]
    message: str


class StopCompetitorResponse(BaseModel):
    status: str
    competitor_id: UUID
    message: str


@router.post(
    "/{avatar_id}/competitors/scrape",
    response_model=ScrapeEnqueueResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def enqueue_competitor_scrape_jobs(
    avatar_id: UUID,
    body: ScrapeEnqueueRequest,
    background_tasks: BackgroundTasks,
    user_id: UUID = Depends(get_current_user_id),
) -> ScrapeEnqueueResponse:
    try:
        from app.clients.supabase_repo import SupabaseRepository
        from app.config import get_settings

        repository = SupabaseRepository(get_settings())
        repository.verify_avatar_owner(avatar_id, user_id)

        competitor_count = repository.count_competitors_for_avatar(avatar_id)
        if competitor_count > MAX_COMPETITORS_PER_AVATAR:
            raise RepositoryError(
                f"An avatar can have at most {MAX_COMPETITORS_PER_AVATAR} competitors.",
            )

        repository.get_competitors_for_avatar(avatar_id, body.competitor_ids)
    except ConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
    except RepositoryError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error

    background_tasks.add_task(run_pipeline_batch, avatar_id, body.competitor_ids)

    logger.info(
        "Queued competitor scrape batch",
        extra={
            "avatar_id": str(avatar_id),
            "user_id": str(user_id),
            "competitor_ids": [str(competitor_id) for competitor_id in body.competitor_ids],
        },
    )

    return ScrapeEnqueueResponse(
        status="queued",
        competitor_ids=body.competitor_ids,
        message=(
            f"Scrape and summarization pipeline queued for {len(body.competitor_ids)} "
            f"competitor(s) on avatar {avatar_id}."
        ),
    )


@router.post(
    "/{avatar_id}/competitors/{competitor_id}/stop",
    response_model=StopCompetitorResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def stop_competitor_pipeline(
    avatar_id: UUID,
    competitor_id: UUID,
    user_id: UUID = Depends(get_current_user_id),
) -> StopCompetitorResponse:
    """Request cooperative stop: keep scraped rows already in DB, then summarize them."""
    try:
        from app.clients.supabase_repo import SupabaseRepository
        from app.config import get_settings

        repository = SupabaseRepository(get_settings())
        repository.verify_avatar_owner(avatar_id, user_id)
        competitor = repository.request_competitor_cancel(avatar_id, competitor_id)
    except ConfigurationError as error:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(error),
        ) from error
    except RepositoryError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error

    logger.info(
        "Requested competitor pipeline stop",
        extra={
            "avatar_id": str(avatar_id),
            "user_id": str(user_id),
            "competitor_id": str(competitor_id),
            "pipeline_step": competitor.get("pipeline_step"),
        },
    )

    return StopCompetitorResponse(
        status="stopping",
        competitor_id=competitor_id,
        message=(
            "Stop requested. ContOS will keep any posts already scraped, skip remaining "
            "phases when possible, and summarize that data."
        ),
    )
