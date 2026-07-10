# Phase 6 — Non-Functional / Hardening

Phase 6 hardens ContOS v1 for production: secret isolation, authenticated pipeline triggers, server-side cost controls, partial-failure UX, and automated guardrail tests.

## Security

### Client-side secret isolation

| Secret | Location | Client exposure |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend `.env` only | Never |
| `APIFY_API_TOKEN` | Backend `.env` only | Never |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | Backend `.env` only | Never |
| `VITE_SUPABASE_ANON_KEY` | Frontend `.env.local` | Yes (by design; RLS enforces access) |

Automated check: `Backend/tests/test_phase6_hardening.py::TestSecretExposureGuards`

### Server-side-only external calls

All Apify and LLM traffic runs through FastAPI:

- `Backend/app/clients/apify_client.py` — Instagram scrape + reel transcription
- `Backend/app/clients/llm_client.py` — summarization
- Frontend only calls `POST /projects/{id}/competitors/scrape` with the user's Supabase JWT

### Authenticated scrape endpoint

`POST /projects/{project_id}/competitors/scrape` requires:

```
Authorization: Bearer <supabase_access_token>
```

The backend validates the JWT via Supabase Auth and verifies the user owns the project before enqueueing pipeline work.

Implementation: `Backend/app/api/deps.py`, `Backend/app/api/routes/projects.py`

## Cost controls

| Control | Enforcement |
| --- | --- |
| 30-day scrape window | `SCRAPE_LOOKBACK_DAYS=30` in backend config + Apify `onlyPostsNewerThan` |
| Apify result cap | `resultsLimit: 50` per profile scrape |
| Transcription batching | 5 URLs per bulk run (`TRANSCRIBE_BATCH_SIZE`), then single-URL retries; optional `APIFY_INSTAGRAM_SESSION_ID` |
| Transcription errors | Stored in `scraped_content.transcription_error` |
| Max 10 competitors / project | Frontend validation + DB trigger (`competitors_enforce_cap`) + backend scrape guard |

**Note:** v1 scrapes all Instagram post types (posts, carousels, reels) but only transcribes reels. Summarization uses captions + metrics for all types; transcripts when available.

Migration: `supabase/migrations/20260708120000_phase6_competitor_cap.sql`

## Partial failure behavior

### Pipeline

- Each competitor runs in an isolated try/except block; one failure does not stop the batch.
- Transcription failures mark individual reel rows `transcription_status = failed` but summarization still runs on captions.

### Project status

`resolve_project_status()` in `Backend/app/services/project_status.py`:

- Any competitor still `pending` / `in_progress` → project `scraping`
- All completed → `ready`
- Mix of completed + failed (none in progress) → `ready` (partial success)
- All failed → `failed`

### Dashboard

- Per-competitor failed cards show `error_message` and a **Retry research** button.
- Amber banner when some competitors failed but the project is otherwise `ready`.

## RLS verification (manual)

Use two test accounts (User A, User B). See `Docs/phase-1-schema.md` for the full procedure.

Minimum checks:

1. User A cannot `SELECT` User B's `projects`, `competitors`, `scraped_content`, or `content_summaries`.
2. User A cannot `INSERT` competitors into User B's project (RLS blocks).
3. User B's JWT cannot enqueue scrapes for User A's project (backend returns 400).

## Idempotency verification

`scraped_content` has `UNIQUE (competitor_id, external_id)`. Re-running a scrape upserts rows instead of duplicating them.

Manual check:

```sql
SELECT competitor_id, external_id, COUNT(*)
FROM scraped_content
GROUP BY 1, 2
HAVING COUNT(*) > 1;
```

Should return zero rows after a re-scrape.

## Running automated tests

```bash
cd Backend
pip install -e ".[dev]"
pytest
```

## Environment changes (Phase 6)

| Variable | Change |
| --- | --- |
| `SCRAPE_LOOKBACK_DAYS` | Default changed from `10` to `30` |
| `APIFY_INSTAGRAM_SESSION_ID` | Optional Instagram cookie for transcription reliability |
| `TRANSCRIBE_BATCH_SIZE` | Default `5` bulk URLs per transcriber run |
| `TRANSCRIBE_RETRY_DELAY_SECS` | Default `1.5` between single-URL retries |

Apply the competitor-cap migration to your Supabase project:

```bash
supabase db push
```

Or run the SQL in `supabase/migrations/20260708120000_phase6_competitor_cap.sql` via the Supabase SQL editor.

## Known limitations

- RLS integration tests require a live Supabase project with two users (not automated in CI yet).
- Scrape endpoint auth relies on Supabase JWT validation; rotate compromised tokens promptly.
- Instagram transcriber may require a `sessionid` for some reels — set `APIFY_INSTAGRAM_SESSION_ID` in backend `.env` (copy from browser devtools → Application → Cookies → `sessionid` on instagram.com).
