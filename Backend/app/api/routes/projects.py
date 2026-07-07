import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.api.deps import get_current_user_id
from app.constants import MAX_COMPETITORS_PER_PROJECT
from app.errors import ConfigurationError, RepositoryError
from app.services.pipeline import run_pipeline_batch

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects", tags=["projects"])


class ScrapeEnqueueRequest(BaseModel):
    competitor_ids: list[UUID] = Field(min_length=1)


class ScrapeEnqueueResponse(BaseModel):
    status: str
    competitor_ids: list[UUID]
    message: str


@router.post(
    "/{project_id}/competitors/scrape",
    response_model=ScrapeEnqueueResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def enqueue_competitor_scrape_jobs(
    project_id: UUID,
    body: ScrapeEnqueueRequest,
    background_tasks: BackgroundTasks,
    user_id: UUID = Depends(get_current_user_id),
) -> ScrapeEnqueueResponse:
    try:
        from app.clients.supabase_repo import SupabaseRepository
        from app.config import get_settings

        repository = SupabaseRepository(get_settings())
        repository.verify_project_owner(project_id, user_id)

        competitor_count = repository.count_competitors_for_project(project_id)
        if competitor_count > MAX_COMPETITORS_PER_PROJECT:
            raise RepositoryError(
                f"A project can have at most {MAX_COMPETITORS_PER_PROJECT} competitors.",
            )

        repository.get_competitors_for_project(project_id, body.competitor_ids)
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

    background_tasks.add_task(run_pipeline_batch, project_id, body.competitor_ids)

    logger.info(
        "Queued competitor scrape batch",
        extra={
            "project_id": str(project_id),
            "user_id": str(user_id),
            "competitor_ids": [str(competitor_id) for competitor_id in body.competitor_ids],
        },
    )

    return ScrapeEnqueueResponse(
        status="queued",
        competitor_ids=body.competitor_ids,
        message=(
            f"Scrape and summarization pipeline queued for {len(body.competitor_ids)} "
            f"competitor(s) on project {project_id}."
        ),
    )
