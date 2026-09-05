"""Phase 6 hardening tests."""

from pathlib import Path

import pytest

from app.services.project_status import resolve_project_status

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ENV_EXAMPLE = REPO_ROOT / "Frontend" / ".env.example"
BACKEND_ENV_EXAMPLE = REPO_ROOT / "Backend" / ".env.example"


class TestProjectStatusResolution:
    def test_empty_statuses_default_to_onboarding(self) -> None:
        assert resolve_project_status([]) == "onboarding"

    def test_in_progress_competitors_keep_project_scraping(self) -> None:
        assert resolve_project_status(["completed", "in_progress"]) == "scraping"
        assert resolve_project_status(["pending", "failed"]) == "scraping"

    def test_all_completed_is_ready(self) -> None:
        assert resolve_project_status(["completed", "completed"]) == "ready"

    def test_all_failed_is_failed(self) -> None:
        assert resolve_project_status(["failed", "failed"]) == "failed"

    def test_partial_success_is_ready(self) -> None:
        assert resolve_project_status(["completed", "failed"]) == "ready"
        assert resolve_project_status(["failed", "completed", "failed"]) == "ready"


class TestSecretExposureGuards:
    FORBIDDEN_FRONTEND_TOKENS = (
        "SERVICE_ROLE",
        "APIFY_API_TOKEN",
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
        "REDIS_URL",
        "CELERY_",
    )

    def test_frontend_env_example_has_no_server_secrets(self) -> None:
        content = FRONTEND_ENV_EXAMPLE.read_text(encoding="utf-8").upper()

        for token in self.FORBIDDEN_FRONTEND_TOKENS:
            assert token not in content, f"Frontend env example must not reference {token}"

    def test_frontend_env_example_only_uses_vite_prefix(self) -> None:
        for line in FRONTEND_ENV_EXAMPLE.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            assert stripped.startswith("VITE_"), f"Unexpected frontend env key: {stripped}"

    def test_backend_env_example_does_not_include_frontend_anon_key(self) -> None:
        content = BACKEND_ENV_EXAMPLE.read_text(encoding="utf-8").upper()
        assert "VITE_SUPABASE_ANON_KEY" not in content


class TestIdempotencyContract:
    def test_instagram_scraped_content_unique_constraint_documented(self) -> None:
        rename_migration = (
            REPO_ROOT / "supabase" / "migrations" / "20260823120000_rename_tables_for_clarity.sql"
        ).read_text(encoding="utf-8")
        base_migration = (
            REPO_ROOT / "supabase" / "migrations" / "20260705120000_create_contos_schema.sql"
        ).read_text(encoding="utf-8")

        assert "instagram_scraped_content" in rename_migration
        assert "scraped_content_competitor_external_id_unique" in base_migration
        assert "UNIQUE (competitor_id, external_id)" in base_migration
