"""Tool: fetch_playbooks — Fortune 500 / strategy playbook rules from Supabase."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def fetch_playbooks(category: str | None = None) -> list[dict[str, Any]]:
    """Query playbooks table (real DB only)."""
    from db import supabase_client as db

    rows = db.fetch_playbook_rows(category)
    for row in rows:
        row["source"] = "supabase"
    logger.info("fetch_playbooks category=%s count=%s", category, len(rows))
    return rows
