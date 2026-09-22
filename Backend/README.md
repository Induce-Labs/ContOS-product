# ContOS Backend

Python FastAPI service for the ContOS v1 scrape → summarize pipeline.

## Prerequisites

- Python 3.11+ (3.13 recommended; use `py -3.13` on Windows if `python` points to 3.10)
- A virtual environment tool (`python -m venv` is fine)
- Docker Desktop (for local Redis via repo-root `docker-compose.yml`)

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

From the **repo root**, start Redis:

```bash
docker compose up -d
```

Edit `.env` and set secrets from the Supabase dashboard and third-party providers:

| Variable | Where to get it |
| --- | --- |
| `SUPABASE_URL` | Supabase → Project Settings → API (use **pooled** URL in production for web + workers) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (server-side only) |
| `REDIS_URL` | Local default `redis://localhost:6379/0`; hosted Redis in production |
| `APIFY_API_TOKEN` | Apify console (Instagram + LinkedIn scrapers) |
| `APIFY_LINKEDIN_ACTOR_ID` | Default `datadoping/linkedin-profile-posts-scraper` |
| `LINKEDIN_MAX_POSTS` | Default `50` (actor min 10; free tier often caps 100/profile, 4 profiles/run) |
| `OPENROUTER_API_KEY` | OpenRouter (dev summarization, Phase 4) |
| `OPENAI_API_KEY` | OpenAI (production summarization, Phase 4) |

Never commit `.env` or expose the service-role key to the frontend.

## Run locally

Two processes (API + Celery scrape worker):

```bash
uvicorn app.main:app --reload --port 8000
celery -A app.celery_app worker --loglevel=info -Q scrape --concurrency=2
# Windows: use threads so two scrapes run in parallel
# celery -A app.celery_app worker --loglevel=info -Q scrape --pool=threads --concurrency=2
```

See [`Docs/phase-celery.md`](../Docs/phase-celery.md).

## Deploy on Railway

1. Create a new Railway service from this GitHub repo.
2. Set **Root Directory** to `Backend`.
3. Railway will install from `requirements.txt` and start via `Procfile`.
4. Add a **second** service for the Celery worker (`Procfile` `worker` line) with the same env, including `REDIS_URL`.
5. Set the environment variables from `.env.example` (never commit real secrets). Use a pooled Supabase URL for web + worker.
6. Generate a public domain and point the frontend `VITE_API_BASE_URL` at it.
7. Set `CORS_ORIGINS` to your Vercel URL (and local origins if needed).

Health check: `GET /health` (includes `"redis": "up"|"down"`; 503 when Redis is down)

API docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### Postiz LinkedIn OAuth (Calendar)

See [`Docs/phase-postiz-linkedin.md`](../Docs/phase-postiz-linkedin.md).

```
GET  /api/postiz/connect?avatar_id=<uuid>
GET  /api/postiz/status?avatar_id=<uuid>
POST /api/postiz/claim
Authorization: Bearer <supabase_access_token>
```

Requires backend env: `POSTIZ_URL`, `CONTOS_PROVISION_SECRET`, `POSTIZ_TOKEN_ENCRYPTION_KEY`.
Never expose these to Vite. Org-consent callback is gone (410).

### Scrape enqueue

```
POST /avatars/{avatar_id}/competitors/scrape
Authorization: Bearer <supabase_access_token>
Body: { "competitor_ids": ["uuid", ...] }
Response: 202 Accepted
```

Requires a valid Supabase user JWT. The backend verifies project ownership before enqueueing work.

Publishes one Celery task per competitor on the `scrape` queue. The worker branches on `competitors.platform`:

**Instagram**

1. Scrapes posts via Apify (`apify/instagram-post-scraper`) into `instagram_scraped_content` (7-day lookback)
2. Transcribes reel URLs via `apple_yang/instagram-transcripts-scraper`
3. Summarizes into `instagram_content_summaries`

**LinkedIn** (see [`Docs/phase-linkedin.md`](../Docs/phase-linkedin.md))

1. Scrapes profile posts via `APIFY_LINKEDIN_ACTOR_ID` into `linkedin_scraped_content` (no transcription)
2. Summarizes into `linkedin_content_summaries`

Set `PIPELINE_VERBOSE=true` in `.env` to see `[PIPELINE] Step 1/3 SCRAPE`, `Step 2/3 TRANSCRIBE`, and `Step 3/3 ANALYZE` in the console.

**Verify in Supabase between phases:**

```sql
SELECT post_url, content_type, likes, transcription_status, transcript IS NOT NULL AS has_transcript
FROM instagram_scraped_content
WHERE competitor_id = 'YOUR_COMPETITOR_ID'
ORDER BY posted_at DESC;
```

After scrape: reels show `transcription_status = pending`, `has_transcript = false`. After transcribe: reels show `completed` with transcripts.

See `Docs/phase-4-pipeline.md` and `Docs/phase-6-hardening.md` for full details and required env vars.

## Architecture (Phase 0)

- `app/main.py` — FastAPI app, CORS, `/health`
- `app/config.py` — environment settings via `pydantic-settings`

Pipeline endpoints and Supabase service integration are added in Phase 4.
