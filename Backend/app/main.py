import logging

from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.avatars import router as avatars_router
from app.config import get_settings
from app.services.redis_health import ping_redis

settings = get_settings()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

_logger = logging.getLogger(__name__)
_supabase_host = settings.supabase_url.split("//", 1)[-1].split("/", 1)[0]
_logger.info(
    "ContOS API starting",
    extra={
        "supabase_host": _supabase_host,
        "service_role_configured": bool(settings.supabase_service_role_key),
        "cors_origins": settings.cors_origin_list,
    },
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

# Browsers treat localhost and 127.0.0.1 as different origins; always allow both for Vite.
cors_origins = list(settings.cors_origin_list)
for _origin in (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
):
    if _origin not in cors_origins:
        cors_origins.append(_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(avatars_router)


@app.get("/health")
def health(response: Response) -> dict[str, str]:
    redis_ok = ping_redis()
    if not redis_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "degraded", "redis": "down"}
    return {"status": "ok", "redis": "up"}
