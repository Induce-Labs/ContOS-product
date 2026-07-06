from uuid import UUID

from fastapi import APIRouter, status
from pydantic import BaseModel, Field

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
) -> ScrapeEnqueueResponse:
    # Phase 4 will implement the async Apify → summarization pipeline.
    return ScrapeEnqueueResponse(
        status="queued",
        competitor_ids=body.competitor_ids,
        message=(
            f"Scrape jobs accepted for project {project_id}. "
            "Pipeline orchestration will run in Phase 4."
        ),
    )
