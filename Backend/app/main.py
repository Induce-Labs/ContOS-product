import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.projects import router as projects_router
from app.config import get_settings

settings = get_settings()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

if settings.pipeline_verbose:
    for logger_name in (
        "app.services.pipeline",
        "app.clients.apify_client",
        "app.clients.supabase_repo",
        "app.services.instagram_parser",
    ):
        logging.getLogger(logger_name).setLevel(logging.DEBUG)

app = FastAPI(
    title="ContOS API",
    description="ContOS v1 backend — competitor scraping and summarization pipeline",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
