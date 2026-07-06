# Phase 4 — Pipeline Orchestration



## Purpose



Run the async competitor intelligence pipeline on the FastAPI backend in three explicit phases:



1. **Scrape** — `apify/instagram-post-scraper` stores all posts (links + metrics) in `scraped_content`

2. **Transcribe** — reel URLs read from `scraped_content` are sent to `tictechid/anoxvanzi-transcriber`; only transcript fields are updated

3. **Analyze** — all scraped content (posts, carousels, reels) summarized via LLM using captions + metrics; reel transcripts included when available



## API



```

POST /projects/{project_id}/competitors/scrape

Content-Type: application/json



{

  "competitor_ids": ["uuid", "..."]

}

```



Returns `202 Accepted` immediately. Work runs in a FastAPI `BackgroundTasks` job.



## Pipeline steps (per competitor)



1. `pipeline_step = scraping`, `scrape_status = in_progress`

2. Run `apify/instagram-post-scraper` for profile URL (`username`, last **10 days** by default)

3. Parse **all post types** and upsert `scraped_content` (metrics + `post_url`; reels get `transcription_status = pending`)

4. `pipeline_step = transcribing`

5. Load pending reel URLs from `scraped_content`, run transcriber, update `transcript` + `transcription_status`

6. `pipeline_step = analyzing`

7. Load **all** scraped rows from DB, summarize via OpenRouter (`openrouter/free`, dev) or OpenAI GPT-4o (prod). Reels without transcripts still use caption + metrics.

8. Replace `content_summaries` row for the competitor

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

| `APIFY_TRANSCRIBER_ACTOR_ID` | No | Default `tictechid/anoxvanzi-transcriber` |

| `SCRAPE_LOOKBACK_DAYS` | No | Default `10` (testing window) |

| `PIPELINE_VERBOSE` | No | `true` enables DEBUG logs for pipeline/Apify/repo |

| `LLM_PROVIDER` | No | `auto`, `openrouter`, or `openai` |

| `OPENROUTER_MODEL` | No | Default `openrouter/free` |



## scraped_content columns (phase tracking)



| Column | Values | Meaning |

| --- | --- | --- |

| `post_url` | Instagram URL | Link used for transcription |

| `transcription_status` | `pending`, `in_progress`, `completed`, `failed`, `not_applicable` | Per-row phase-2 state |

| `content_type` | `reel`, `post`, `carousel`, `video` | From Apify payload |



## Verifying between phases (Supabase SQL)



After scrape (step 1):



```sql

SELECT post_url, content_type, likes, comments_count, transcription_status, transcript

FROM scraped_content

WHERE competitor_id = '...'

ORDER BY posted_at DESC;

```



After transcribe (step 2): reel rows should have `transcript` filled and `transcription_status = completed`.



Competitor status: `scraping` → `transcribing` → `analyzing` → `done`.



## Summary JSON shape



Stored in `content_summaries.summary`:



- `top_performing_content[]` (includes `content_type` per item)
- `recurring_hooks_patterns[]`
- `content_strategies_themes[]`
- `aggregated_engagement_metrics` (`total_content_count`, `reel_count`, `post_count`, `carousel_count`, averages)
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

6. Inspect `scraped_content` in Supabase between phases



## Known limitations



- Uses Apify sync actor endpoints (simple for v1; may need queue/worker at scale)

- Transcription batching assumes transcriber output can be mapped back to reel URLs

- Transcription failures do not block summarization; posts and reels without transcripts use captions + metrics

- Dashboard progress UI still ships in Phase 5

