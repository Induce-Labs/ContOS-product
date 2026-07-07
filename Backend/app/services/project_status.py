"""Pure helpers for project-level status aggregation."""

IN_PROGRESS_SCRAPE_STATUSES = frozenset({"pending", "in_progress"})


def resolve_project_status(scrape_statuses: list[str]) -> str:
    """Map competitor scrape_status values to a project status.

    Partial success (some completed, some failed) resolves to ``ready`` so the
    dashboard can show per-competitor outcomes without marking the whole project failed.
    """
    if not scrape_statuses:
        return "onboarding"

    if any(status in IN_PROGRESS_SCRAPE_STATUSES for status in scrape_statuses):
        return "scraping"

    if all(status == "completed" for status in scrape_statuses):
        return "ready"

    if all(status == "failed" for status in scrape_statuses):
        return "failed"

    if any(status == "completed" for status in scrape_statuses):
        return "ready"

    return "failed"
