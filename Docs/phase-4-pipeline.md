# Phase 4 — Pipeline Orchestration



## Purpose



Run the async competitor intelligence pipeline on the FastAPI backend in three explicit phases:



1. **Scrape** — `apify/instagram-post-scraper` stores all posts (links + metrics) in `instagram_scraped_content`

2. **Transcribe** — reel URLs read from `instagram_scraped_content` are sent to `apple_yang/instagram-transcripts-scraper` (`bulkUrls`); only transcript fields are updated

3. **Analyze** — all scraped content (posts, carousels, reels) summarized via LLM using captions + metrics; reel transcripts included when available



## API

```
POST /avatars/{avatar_id}/competitors/scrape
Content-Type: application/json
Authorization: Bearer <supabase_access_token>

{
  "competitor_ids": ["uuid", "..."]
}
```

```
POST /avatars/{avatar_id}/competitors/{competitor_id}/stop
Authorization: Bearer <supabase_access_token>
```

**Stop research (cooperative cancel)**

- Available while `pipeline_step` is `scraping`, `transcribing`, or `analyzing`
- Sets `competitors.cancel_requested = true`
- After the current Apify/LLM call finishes, ContOS skips remaining phases when possible
- Any rows already written to `instagram_scraped_content` / `linkedin_scraped_content` are kept
- Pipeline then runs Analyze on that stored data and marks the competitor `done`
- If Stop happens before any posts are stored, competitor is marked `failed` with a clear message
- Note: Apify uses blocking sync runs today, so Stop cannot abort mid-actor; it takes effect at the next phase boundary

Migration: `supabase/migrations/20260810120000_competitor_cancel_requested.sql`




Returns `202 Accepted` immediately. Work is published to the Celery `scrape` queue (Redis broker). See [`Docs/phase-celery.md`](./phase-celery.md).



## Pipeline steps (per competitor)



1. `pipeline_step = scraping`, `scrape_status = in_progress`

2. Run `apify/instagram-post-scraper` for profile URL (`username`, last **10 days** by default)

3. Parse **all post types** and upsert `instagram_scraped_content` (metrics + `post_url`; reels get `transcription_status = pending`)

4. `pipeline_step = transcribing`

5. Load pending reel URLs from `instagram_scraped_content`, run transcriber, update `transcript` + `transcription_status`

6. `pipeline_step = analyzing`

7. Load top scraped rows (by engagement, capped at `LLM_MAX_CONTENT_ITEMS`), summarize via OpenRouter (`google/gemini-2.5-flash`) or OpenAI GPT-4o. Reels without transcripts still use caption + metrics.

8. Replace `instagram_content_summaries` row for the competitor

9. `pipeline_step = done`, `scrape_status = completed`, `last_scraped_at = now()`

10. Refresh parent `projects.status` (`scraping` → `ready` or `failed`)



Failures are isolated per competitor: one failure does not stop others in the batch.



## Backend layout



| Path | Role |

| --- | --- |

| `app/api/routes/projects.py` | Enqueue endpoint |

| `app/services/pipeline.py` | Batch + per-competitor orchestration (3 phases) |

| `app/services/instagram_parser.py` | All-post parsing + reel classification |

| `app/clients/apify_client.py` | Apify actor calls |

| `app/clients/llm_client.py` | Structured JSON summarization |

| `app/clients/supabase_repo.py` | Service-role DB writes + transcription queries |

| `app/models/summary.py` | Summary JSON schema |



## Environment variables



| Variable | Required | Description |

| --- | --- | --- |

| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-side DB writes (bypasses RLS) |

| `APIFY_API_TOKEN` | Yes | Apify actor runs |

| `OPENROUTER_API_KEY` | Dev | Used when `LLM_PROVIDER=auto/openrouter` |

| `OPENAI_API_KEY` | Prod | Used when `LLM_PROVIDER=openai` or as fallback |

| `APIFY_INSTAGRAM_ACTOR_ID` | No | Default `apify/instagram-post-scraper` |

| `APIFY_TRANSCRIBER_ACTOR_ID` | No | Default `apple_yang/instagram-transcripts-scraper` |

| `APIFY_INSTAGRAM_SESSION_ID` | No | Instagram `sessionid` cookie for more reliable reel transcription |

| `TRANSCRIBE_BATCH_SIZE` | No | Default `5` (Apify free-tier bulk URL cap) |

| `TRANSCRIBE_RETRY_DELAY_SECS` | No | Default `1.5` seconds between single-URL retries |

| `SCRAPE_LOOKBACK_DAYS` | No | Default `7` (last week only) |

| `PIPELINE_VERBOSE` | No | `true` enables DEBUG logs for pipeline/Apify/repo |

| `LLM_PROVIDER` | No | `auto`, `openrouter`, or `openai` |

| `OPENROUTER_MODEL` | No | Default `google/gemini-2.5-flash` |
| `LLM_TIMEOUT_SECS` | No | Default `120` |
| `LLM_MAX_TOKENS` | No | Default `4096` |
| `LLM_MAX_CONTENT_ITEMS` | No | Default `10` (top posts by engagement sent to LLM) |



## instagram_scraped_content columns (phase tracking)



| Column | Values | Meaning |

| --- | --- | --- |

| `post_url` | Instagram URL | Link used for transcription |

| `transcription_status` | `pending`, `in_progress`, `completed`, `failed`, `not_applicable` | Per-row phase-2 state |

| `transcription_error` | text | Apify transcriber failure reason when `transcription_status = failed` |

| `content_type` | `reel`, `post`, `carousel`, `video` | From Apify payload |



## Verifying between phases (Supabase SQL)



After scrape (step 1):



```sql

SELECT post_url, content_type, likes, comments_count, transcription_status, transcript

FROM instagram_scraped_content

WHERE competitor_id = '...'

ORDER BY posted_at DESC;

```



After transcribe (step 2): reel rows should have `transcript` filled and `transcription_status = completed`.



Competitor status: `scraping` → `transcribing` → `analyzing` → `done`.



## Summary JSON shape



Stored in `instagram_content_summaries.summary`:



- `top_performing_content[]` (includes `content_type` per item)
- `recurring_hooks_patterns[]`
- `content_strategies_themes[]`
- `aggregated_engagement_metrics` (`total_content_count`, `reel_count`, `post_count`, `carousel_count`, averages) — **computed server-side from `instagram_scraped_content`**, not by the LLM
- `top_performing_content` engagement numbers are **enriched from `instagram_scraped_content`** by `external_id` after the LLM returns qualitative analysis
- `strategic_signals[]`



## Security



- Apify and LLM keys are backend-only

- Service-role key never exposed to frontend

- Endpoint validates competitor IDs belong to the project before queueing

- Pipeline logs do not print API tokens or full `raw_payload` at INFO level



## Manual test



1. Set `SUPABASE_SERVICE_ROLE_KEY`, `APIFY_API_TOKEN`, and `OPENROUTER_API_KEY` in `Backend/.env`

2. Set `PIPELINE_VERBOSE=true` for detailed console output

3. Start backend: `uvicorn app.main:app --reload --port 8000`

4. Create a project with competitors from the frontend

5. Watch `[PIPELINE] Step 1/3 SCRAPE`, `Step 2/3 TRANSCRIBE`, `Step 3/3 ANALYZE` in backend logs

6. Inspect `instagram_scraped_content` in Supabase between phases



## Known limitations



- Uses Celery workers + Redis for scrape jobs at scale (see [`phase-celery.md`](./phase-celery.md)); Apify actor calls remain sync inside each worker task

- Transcriber sends reel URLs in `bulkUrls` batches of `TRANSCRIBE_BATCH_SIZE` (default 5), retries failures one URL at a time, and stores `transcription_error` on failures

- Transcription failures do not block summarization; posts and reels without transcripts use captions + metrics

- Dashboard progress UI still ships in Phase 5

