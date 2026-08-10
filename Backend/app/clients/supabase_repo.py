import logging
from datetime import datetime
from typing import Any
from uuid import UUID
from supabase import Client, create_client
from app.config import Settings
from app.errors import ConfigurationError, RepositoryError
from app.services.project_status import resolve_project_status

logger = logging.getLogger(__name__)


class SupabaseRepository:
    def __init__(self, settings: Settings) -> None:
        if not settings.supabase_service_role_key:
            raise ConfigurationError(
                "SUPABASE_SERVICE_ROLE_KEY is required for pipeline database writes.",
            )
        self._client: Client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
        )

    def get_competitors_for_project(
        self,
        project_id: UUID,
        competitor_ids: list[UUID],
    ) -> list[dict[str, Any]]:
        query = self._client.table("competitors").select("*").eq("project_id", str(project_id))
        if competitor_ids:
            query = query.in_("id", [str(competitor_id) for competitor_id in competitor_ids])
        response = query.execute()
        if response.data is None:
            raise RepositoryError("Supabase returned no competitor data.")
        if len(response.data) != len(competitor_ids):
            raise RepositoryError(
                "One or more competitor IDs do not belong to the specified project.",
            )
        return response.data

    def verify_project_owner(self, project_id: UUID, user_id: UUID) -> None:
        response = (
            self._client.table("projects")
            .select("id")
            .eq("id", str(project_id))
            .eq("user_id", str(user_id))
            .maybe_single()
            .execute()
        )
        if response.data is None:
            raise RepositoryError(
                "Project not found or you do not have permission to access it.",
            )

    def count_competitors_for_project(self, project_id: UUID) -> int:
        response = (
            self._client.table("competitors")
            .select("id", count="exact")
            .eq("project_id", str(project_id))
            .execute()
        )
        if response.count is None:
            raise RepositoryError(
                f"Failed to count competitors for project {project_id}.",
            )
        return response.count

    def update_competitor_status(
        self,
        competitor_id: UUID,
        *,
        scrape_status: str,
        pipeline_step: str,
        error_message: str | None = None,
        last_scraped_at: datetime | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "scrape_status": scrape_status,
            "pipeline_step": pipeline_step,
            "error_message": error_message,
        }
        if last_scraped_at is not None:
            payload["last_scraped_at"] = last_scraped_at.isoformat()
        response = (
            self._client.table("competitors").update(payload).eq("id", str(competitor_id)).execute()
        )
        if response.data is None:
            raise RepositoryError(
                f"Failed to update competitor {competitor_id} status in Supabase.",
            )

    def request_competitor_cancel(
        self,
        project_id: UUID,
        competitor_id: UUID,
    ) -> dict[str, Any]:
        """Mark an in-flight competitor pipeline for cooperative stop."""
        response = (
            self._client.table("competitors")
            .select("id, project_id, pipeline_step, scrape_status, cancel_requested")
            .eq("id", str(competitor_id))
            .eq("project_id", str(project_id))
            .maybe_single()
            .execute()
        )
        if response.data is None:
            raise RepositoryError(
                "Competitor not found or does not belong to the specified project.",
            )

        pipeline_step = str(response.data.get("pipeline_step") or "")
        if pipeline_step not in {"scraping", "transcribing", "analyzing"}:
            raise RepositoryError(
                f"Competitor {competitor_id} is not running "
                f"(pipeline_step={pipeline_step}). Stop is only available while research is in progress.",
            )

        if response.data.get("cancel_requested"):
            return response.data

        update_response = (
            self._client.table("competitors")
            .update({"cancel_requested": True})
            .eq("id", str(competitor_id))
            .eq("project_id", str(project_id))
            .execute()
        )
        if update_response.data is None:
            raise RepositoryError(
                f"Failed to request cancel for competitor {competitor_id}.",
            )

        return {**response.data, "cancel_requested": True}

    def is_cancel_requested(self, competitor_id: UUID) -> bool:
        response = (
            self._client.table("competitors")
            .select("cancel_requested")
            .eq("id", str(competitor_id))
            .maybe_single()
            .execute()
        )
        if response.data is None:
            raise RepositoryError(f"Competitor {competitor_id} was not found.")
        return bool(response.data.get("cancel_requested"))

    def clear_cancel_requested(self, competitor_id: UUID) -> None:
        response = (
            self._client.table("competitors")
            .update({"cancel_requested": False})
            .eq("id", str(competitor_id))
            .execute()
        )
        if response.data is None:
            raise RepositoryError(
                f"Failed to clear cancel flag for competitor {competitor_id}.",
            )

    def upsert_scraped_content(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        response = (
            self._client.table("scraped_content")
            .upsert(rows, on_conflict="competitor_id,external_id")
            .execute()
        )
        if response.data is None:
            raise RepositoryError("Failed to upsert scraped_content rows in Supabase.")
        logger.info(
            "Upserted scraped_content rows",
            extra={"row_count": len(rows)},
        )

    def get_posts_pending_transcription(self, competitor_id: UUID) -> list[dict[str, Any]]:
        response = (
            self._client.table("scraped_content")
            .select("id, post_url, external_id")
            .eq("competitor_id", str(competitor_id))
            .in_("transcription_status", ["pending", "failed"])
            .execute()
        )
        if response.data is None:
            raise RepositoryError(
                f"Failed to load pending transcription rows for competitor {competitor_id}.",
            )
        return response.data

    def mark_transcription_in_progress(self, row_ids: list[str]) -> None:
        if not row_ids:
            return
        response = (
            self._client.table("scraped_content")
            .update({"transcription_status": "in_progress"})
            .in_("id", row_ids)
            .execute()
        )
        if response.data is None:
            raise RepositoryError("Failed to mark transcription rows as in_progress.")
        logger.info(
            "Marked transcription rows in_progress",
            extra={"row_count": len(row_ids)},
        )

    def update_scraped_content_transcripts(
        self,
        competitor_id: UUID,
        updates: list[dict[str, Any]],
    ) -> int:
        updated_count = 0
        for update in updates:
            response = (
                self._client.table("scraped_content")
                .update(
                    {
                        "transcript": update["transcript"],
                        "transcript_source": update.get("transcript_source"),
                        "transcription_status": update["transcription_status"],
                        "transcription_error": update.get("transcription_error"),
                    },
                )
                .eq("competitor_id", str(competitor_id))
                .eq("post_url", update["post_url"])
                .execute()
            )
            if response.data is None:
                raise RepositoryError(
                    f"Failed to update transcript for post_url {update['post_url']}.",
                )
            if response.data:
                updated_count += len(response.data)
        logger.info(
            "Updated scraped_content transcripts",
            extra={
                "competitor_id": str(competitor_id),
                "update_count": len(updates),
                "rows_updated": updated_count,
            },
        )
        return updated_count

    def get_content_for_summary(self, competitor_id: UUID) -> list[dict[str, Any]]:
        response = (
            self._client.table("scraped_content")
            .select(
                "external_id, post_url, caption, transcript, likes, views, shares, "
                "comments_count, posted_at, content_type, transcription_status",
            )
            .eq("competitor_id", str(competitor_id))
            .order("posted_at", desc=True)
            .execute()
        )
        if response.data is None:
            raise RepositoryError(
                f"Failed to load content for summary for competitor {competitor_id}.",
            )
        return response.data

    def replace_content_summary(
        self,
        *,
        competitor_id: UUID,
        project_id: UUID,
        summary: dict[str, Any],
        model_used: str,
    ) -> None:
        delete_response = (
            self._client.table("content_summaries")
            .delete()
            .eq("competitor_id", str(competitor_id))
            .execute()
        )
        if delete_response.data is None:
            raise RepositoryError(
                f"Failed to clear existing summaries for competitor {competitor_id}.",
            )
        insert_response = (
            self._client.table("content_summaries")
            .insert(
                {
                    "competitor_id": str(competitor_id),
                    "project_id": str(project_id),
                    "summary": summary,
                    "model_used": model_used,
                },
            )
            .execute()
        )
        if insert_response.data is None:
            raise RepositoryError(
                f"Failed to insert content summary for competitor {competitor_id}.",
            )

    def upsert_linkedin_scraped_content(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        response = (
            self._client.table("linkedin_scraped_content")
            .upsert(rows, on_conflict="competitor_id,external_id")
            .execute()
        )
        if response.data is None:
            raise RepositoryError("Failed to upsert linkedin_scraped_content rows in Supabase.")
        logger.info(
            "Upserted linkedin_scraped_content rows",
            extra={"row_count": len(rows)},
        )

    def get_linkedin_content_for_summary(self, competitor_id: UUID) -> list[dict[str, Any]]:
        response = (
            self._client.table("linkedin_scraped_content")
            .select(
                "external_id, post_url, caption, likes, shares, comments_count, "
                "posted_at, author_name, author_headline",
            )
            .eq("competitor_id", str(competitor_id))
            .order("posted_at", desc=True)
            .execute()
        )
        if response.data is None:
            raise RepositoryError(
                f"Failed to load LinkedIn content for summary for competitor {competitor_id}.",
            )
        return response.data

    def replace_linkedin_content_summary(
        self,
        *,
        competitor_id: UUID,
        project_id: UUID,
        summary: dict[str, Any],
        model_used: str,
    ) -> None:
        delete_response = (
            self._client.table("linkedin_content_summaries")
            .delete()
            .eq("competitor_id", str(competitor_id))
            .execute()
        )
        if delete_response.data is None:
            raise RepositoryError(
                f"Failed to clear existing LinkedIn summaries for competitor {competitor_id}.",
            )
        insert_response = (
            self._client.table("linkedin_content_summaries")
            .insert(
                {
                    "competitor_id": str(competitor_id),
                    "project_id": str(project_id),
                    "summary": summary,
                    "model_used": model_used,
                },
            )
            .execute()
        )
        if insert_response.data is None:
            raise RepositoryError(
                f"Failed to insert LinkedIn content summary for competitor {competitor_id}.",
            )

    def refresh_project_status(self, project_id: UUID) -> None:
        response = (
            self._client.table("competitors")
            .select("scrape_status")
            .eq("project_id", str(project_id))
            .execute()
        )
        if not response.data:
            return
        project_status = resolve_project_status(
            [row["scrape_status"] for row in response.data],
        )
        update_response = (
            self._client.table("projects")
            .update({"status": project_status})
            .eq("id", str(project_id))
            .execute()
        )
        if update_response.data is None:
            raise RepositoryError(f"Failed to update project {project_id} status in Supabase.")
