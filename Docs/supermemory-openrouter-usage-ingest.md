# Supermemory OpenRouter usage ingest

## Purpose

Meter Supermemory’s OpenRouter LLM + embedding spend into ContOS `usage_events` (`supermemory_llm` / `supermemory_embed`) using the OpenRouter Management API.

## Implementation overview

1. `services/openrouter_analytics.py` — Management API client (`/keys`, `/activity`), key-hash resolution, embedding-model classification.
2. `services/supermemory_usage_ingest.py` — Aggregates activity for one UTC day and writes idempotent ledger rows (`source_ref` = `sm-or:{date}:{model}:{kind}`).
3. `tasks/usage_metering.py` — Celery task `usage.ingest_supermemory_openrouter`.
4. Admin trigger — `POST /api/admin/usage/supermemory-openrouter/ingest`.

## Architecture decisions

- Day-grain OpenRouter `/activity` only (no per-request SM hooks).
- Filter by SM-only API key hash so Agents inference spend stays separate.
- Client-side date filter because OpenRouter stores dates as `YYYY-MM-DD 00:00:00`.
- `estimated_cost_usd` from ContOS rate card; provider USD kept in metadata as `openrouter_usage_usd`.

## API

`POST /api/admin/usage/supermemory-openrouter/ingest`

```json
{ "usage_date": "2026-11-10", "async_enqueue": false }
```

Requires `AGENTS_ADMIN_USER_IDS`. Optional `async_enqueue` queues the Celery task.

## Schema

- Unique index `usage_events_sm_or_source_ref_uidx` on `source_ref WHERE source_ref LIKE 'sm-or:%'`.
- Rate rows for `openai/gpt-4.1-mini` (SM extraction) plus existing `openai/text-embedding-3-small`.

## Configuration

| Variable | Where |
| --- | --- |
| `OPENROUTER_MANAGEMENT_KEY` | `contos-agents`, `contos-agents-worker`, beat |
| `SUPERMEMORY_OPENROUTER_API_KEY_HASH` | same |
| `SUPERMEMORY_OPENROUTER_KEY_NAME` | optional fallback (`supermemory`) |
| `SUPERMEMORY_USAGE_INGEST_HOUR_UTC` / `_MINUTE_UTC` | beat schedule (default 02:15 UTC) |

## Dependencies

None new — uses stdlib HTTP + existing Supabase usage RPC.

## Known limitations

- OpenRouter activity covers **completed** UTC days only (today is excluded until tomorrow).
- Embeddings on the SM-only key may take a day to appear after cutover; older embed spend may still sit on the shared Agents key.
- Celery Beat requires a dedicated Railway process (`Procfile` `beat`). Until that service exists, use the admin endpoint or `celery -A celery_app call usage.ingest_supermemory_openrouter`.

## Future improvements

- Railway `contos-agents-beat` service wired to Redis + same env as the worker.
- Optional backfill CLI for arbitrary date ranges with progress logging.
