from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    supabase_url: str = Field(validation_alias="SUPABASE_URL")
    supabase_service_role_key: str = Field(
        default="",
        validation_alias="SUPABASE_SERVICE_ROLE_KEY",
    )
    apify_api_token: str = Field(default="", validation_alias="APIFY_API_TOKEN")
    openrouter_api_key: str = Field(default="", validation_alias="OPENROUTER_API_KEY")
    openai_api_key: str = Field(default="", validation_alias="OPENAI_API_KEY")
    cors_origins: str = Field(
        default=(
            "http://localhost:5173,http://127.0.0.1:5173,"
            "http://localhost:5174,http://127.0.0.1:5174"
        ),
        validation_alias="CORS_ORIGINS",
    )
    apify_instagram_actor_id: str = Field(
        default="apify/instagram-post-scraper",
        validation_alias="APIFY_INSTAGRAM_ACTOR_ID",
    )
    apify_transcriber_actor_id: str = Field(
        default="apple_yang/instagram-transcripts-scraper",
        validation_alias="APIFY_TRANSCRIBER_ACTOR_ID",
    )
    apify_linkedin_actor_id: str = Field(
        default="datadoping/linkedin-profile-posts-scraper",
        validation_alias="APIFY_LINKEDIN_ACTOR_ID",
    )
    linkedin_max_posts: int = Field(default=50, validation_alias="LINKEDIN_MAX_POSTS")
    apify_twitter_actor_id: str = Field(
        default="xquik/x-tweet-scraper",
        validation_alias="APIFY_TWITTER_ACTOR_ID",
    )
    twitter_max_items: int = Field(default=50, validation_alias="TWITTER_MAX_ITEMS")
    apify_wait_secs: int = Field(default=300, validation_alias="APIFY_WAIT_SECS")
    apify_instagram_session_id: str = Field(
        default="",
        validation_alias="APIFY_INSTAGRAM_SESSION_ID",
    )
    transcribe_batch_size: int = Field(default=5, validation_alias="TRANSCRIBE_BATCH_SIZE")
    transcribe_retry_delay_secs: float = Field(
        default=1.5,
        validation_alias="TRANSCRIBE_RETRY_DELAY_SECS",
    )
    scrape_lookback_days: int = Field(default=7, validation_alias="SCRAPE_LOOKBACK_DAYS")
    pipeline_verbose: bool = Field(default=False, validation_alias="PIPELINE_VERBOSE")
    llm_provider: str = Field(default="auto", validation_alias="LLM_PROVIDER")
    openrouter_model: str = Field(
        default="google/gemini-2.5-flash",
        validation_alias="OPENROUTER_MODEL",
    )
    openai_model: str = Field(default="gpt-4o", validation_alias="OPENAI_MODEL")
    llm_max_retries: int = Field(default=2, validation_alias="LLM_MAX_RETRIES")
    llm_timeout_secs: int = Field(default=120, validation_alias="LLM_TIMEOUT_SECS")
    llm_max_tokens: int = Field(default=4096, validation_alias="LLM_MAX_TOKENS")
    llm_max_content_items: int = Field(default=10, validation_alias="LLM_MAX_CONTENT_ITEMS")
    redis_url: str = Field(
        default="redis://localhost:6379/0",
        validation_alias="REDIS_URL",
    )
    celery_task_soft_time_limit: int = Field(
        default=840,
        validation_alias="CELERY_TASK_SOFT_TIME_LIMIT",
    )
    celery_task_time_limit: int = Field(
        default=900,
        validation_alias="CELERY_TASK_TIME_LIMIT",
    )
    celery_worker_concurrency: int = Field(
        default=2,
        validation_alias="CELERY_WORKER_CONCURRENCY",
    )
    celery_scrape_rate_limit: str = Field(
        default="10/m",
        validation_alias="CELERY_SCRAPE_RATE_LIMIT",
    )
    celery_task_max_retries: int = Field(
        default=2,
        validation_alias="CELERY_TASK_MAX_RETRIES",
    )
    celery_task_retry_backoff: int = Field(
        default=15,
        validation_alias="CELERY_TASK_RETRY_BACKOFF",
    )
    postiz_url: str = Field(default="", validation_alias="POSTIZ_URL")
    postiz_client_id: str = Field(default="", validation_alias="POSTIZ_CLIENT_ID")
    postiz_client_secret: str = Field(default="", validation_alias="POSTIZ_CLIENT_SECRET")
    postiz_redirect_uri: str = Field(default="", validation_alias="POSTIZ_REDIRECT_URI")
    postiz_token_encryption_key: str = Field(
        default="",
        validation_alias="POSTIZ_TOKEN_ENCRYPTION_KEY",
    )
    contos_provision_secret: str = Field(
        default="",
        validation_alias="CONTOS_PROVISION_SECRET",
    )
    sentry_dsn: str = Field(default="", validation_alias="SENTRY_DSN")
    sentry_environment: str = Field(default="", validation_alias="SENTRY_ENVIRONMENT")

    @field_validator("contos_provision_secret", mode="before")
    @classmethod
    def _normalize_contos_provision_secret(cls, value: object) -> object:
        """Collapse whitespace so pasted hex secrets still match Postiz timingSafeEqual."""
        if isinstance(value, str):
            return "".join(value.split())
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def postiz_base_url(self) -> str:
        return self.postiz_url.strip().rstrip("/")

    @property
    def postiz_oauth_token_url(self) -> str:
        return f"{self.postiz_base_url}/api/oauth/token"

    @property
    def postiz_public_api_base_url(self) -> str:
        return f"{self.postiz_base_url}/api/public/v1"

    @property
    def postiz_provision_avatar_url(self) -> str:
        return f"{self.postiz_base_url}/api/internal/contos/provision-avatar"

    @property
    def postiz_rotate_avatar_token_url(self) -> str:
        return f"{self.postiz_base_url}/api/internal/contos/rotate-avatar-token"

    def resolved_llm_provider(self) -> str:
        provider = self.llm_provider.strip().lower()

        if provider in {"openrouter", "openai"}:
            return provider

        if self.openrouter_api_key:
            return "openrouter"

        if self.openai_api_key:
            return "openai"

        return "openrouter"


@lru_cache
def get_settings() -> Settings:
    return Settings()
