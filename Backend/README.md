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

### Scrape enqueue

```
POST /projects/{project_id}/competitors/scrape
Body: { "competitor_ids": ["uuid", ...] }
Response: 202 Accepted
```

Queues a FastAPI background task that:

1. Scrapes all Instagram posts via Apify (`apify/instagram-post-scraper`) into `scraped_content` (10-day lookback)
2. Transcribes reel URLs from `scraped_content` via `tictechid/anoxvanzi-transcriber`
3. Summarizes all scraped content (posts, carousels, reels) via captions + metrics; reel transcripts included when available
4. Writes to Supabase (`scraped_content`, `content_summaries`, competitor status)

Set `PIPELINE_VERBOSE=true` in `.env` to see `[PIPELINE] Step 1/3 SCRAPE`, `Step 2/3 TRANSCRIBE`, and `Step 3/3 ANALYZE` in the console.

**Verify in Supabase between phases:**

```sql
SELECT post_url, content_type, likes, transcription_status, transcript IS NOT NULL AS has_transcript
FROM scraped_content
WHERE competitor_id = 'YOUR_COMPETITOR_ID'
ORDER BY posted_at DESC;
```

After scrape: reels show `transcription_status = pending`, `has_transcript = false`. After transcribe: reels show `completed` with transcripts.

See `Docs/phase-4-pipeline.md` for full details and required env vars.

## Architecture (Phase 0)

- `app/main.py` — FastAPI app, CORS, `/health`
- `app/config.py` — environment settings via `pydantic-settings`

Pipeline endpoints and Supabase service integration are added in Phase 4.
