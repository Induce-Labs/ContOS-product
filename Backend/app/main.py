import logging

from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.api.routes.avatars import router as avatars_router
from app.api.routes.postiz import router as postiz_router
from app.config import get_settings
from app.monitoring import capture_server_exception, init_glitchtip
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

init_glitchtip(settings.sentry_dsn, settings.sentry_environment)

app = FastAPI(
    title="ContOS API",
    description="ContOS v1 backend — competitor scraping and summarization pipeline",
    version="0.1.0",
)

class _UnhandledErrorMiddleware:
    """Turn unhandled errors into responses inside CORSMiddleware.

    Starlette's server-error middleware sits outside CORS and emits 500s with
    no Access-Control-Allow-Origin header. Browsers then report a CORS failure.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        response_started = False

        async def _send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, receive, _send)
        except Exception as exc:
            if response_started:
                raise
            capture_server_exception(exc)
            _logger.exception(
                "Unhandled request error",
                extra={"path": scope.get("path"), "method": scope.get("method")},
            )
            response = JSONResponse(
                status_code=500,
                content={"detail": "Internal server error"},
            )
            await response(scope, receive, send)


# Browsers treat localhost and 127.0.0.1 as different origins; always allow both for Vite.
# Registered before CORSMiddleware so this handler stays inside it (add_middleware is outer-last).
app.add_middleware(_UnhandledErrorMiddleware)

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
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(avatars_router)
app.include_router(postiz_router)


@app.get("/health")
def health(response: Response) -> dict[str, str]:
    redis_ok = ping_redis()
    if not redis_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "degraded", "redis": "down"}
    return {"status": "ok", "redis": "up"}
