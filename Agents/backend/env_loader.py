"""Load ContOS env files without requiring a duplicated Agents/.env.

Order:
1. Repo root `.env`
2. Scrape `Backend/.env` (shared SUPABASE / OPENROUTER keys)
3. `Agents/backend/.env` — only non-empty values override (blank example keys must not wipe secrets)
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

_AGENTS_BACKEND_ROOT = Path(__file__).resolve().parent
_REPO_ROOT = _AGENTS_BACKEND_ROOT.parent.parent
_SCRAPE_BACKEND_ENV = _REPO_ROOT / "Backend" / ".env"


def load_agents_env() -> None:
    load_dotenv(_REPO_ROOT / ".env", override=False)
    load_dotenv(_SCRAPE_BACKEND_ENV, override=False)

    agents_env = _AGENTS_BACKEND_ROOT / ".env"
    if not agents_env.is_file():
        return

    for key, value in dotenv_values(agents_env).items():
        if key and value is not None and str(value).strip() != "":
            os.environ[key] = str(value)
