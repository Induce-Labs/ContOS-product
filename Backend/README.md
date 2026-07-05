# ContOS Backend

Python FastAPI service for the ContOS v1 scrape → summarize pipeline.

## Prerequisites

- Python 3.11+ (3.13 recommended; use `py -3.13` on Windows if `python` points to 3.10)
- A virtual environment tool (`python -m venv` is fine)

## Setup

```bash
cd Backend
py -3.13 -m venv .venv

# Windows PowerShell
.\.venv\Scripts\Activate.ps1

# macOS / Linux
# source .venv/bin/activate

pip install -e .
cp .env.example .env
```

Edit `.env` and set secrets from the Supabase dashboard and third-party providers:

| Variable | Where to get it |
| --- | --- |
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (server-side only) |
| `APIFY_API_TOKEN` | Apify console (Phase 4) |
| `OPENROUTER_API_KEY` | OpenRouter (dev summarization, Phase 4) |
| `OPENAI_API_KEY` | OpenAI (production summarization, Phase 4) |

Never commit `.env` or expose the service-role key to the frontend.

## Run locally

```bash
uvicorn app.main:app --reload --port 8000
```

Health check: [http://localhost:8000/health](http://localhost:8000/health)

API docs: [http://localhost:8000/docs](http://localhost:8000/docs)

## Architecture (Phase 0)

- `app/main.py` — FastAPI app, CORS, `/health`
- `app/config.py` — environment settings via `pydantic-settings`

Pipeline endpoints and Supabase service integration are added in Phase 4.
