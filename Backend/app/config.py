from functools import lru_cache

from pydantic import Field
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
        default="http://localhost:5173,http://localhost:5174",
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
    scrape_lookback_days: int = Field(default=30, validation_alias="SCRAPE_LOOKBACK_DAYS")
    pipeline_verbose: bool = Field(default=False, validation_alias="PIPELINE_VERBOSE")
    llm_provider: str = Field(default="auto", validation_alias="LLM_PROVIDER")
    openrouter_model: str = Field(
        default="openrouter/free",
        validation_alias="OPENROUTER_MODEL",
    )
    openai_model: str = Field(default="gpt-4o", validation_alias="OPENAI_MODEL")
    llm_max_retries: int = Field(default=2, validation_alias="LLM_MAX_RETRIES")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

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
