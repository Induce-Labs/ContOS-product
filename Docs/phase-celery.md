# Phase Celery — Redis queues for scrape + website

## Purpose

Move long Apify/LLM jobs off FastAPI request threads onto Celery workers backed by a shared Redis broker so ContOS stays responsive under concurrent users.

## Architecture

| Queue | Service | Jobs |
| --- | --- | --- |
| `scrape` | Backend (`:8000`) worker | Instagram/LinkedIn competitor pipeline |
| `website` | Agents (`:8001`) worker | Website Content Crawler + website/profile summary |

Chat SSE (`POST /api/agents/invoke`) stays on the Agents HTTP process — never Celery.

```text
Frontend
  ├─ POST /avatars/{id}/competitors/scrape  → Backend web → Redis scrape → Backend worker → Supabase
  └─ POST /api/profiling/summarize          → Agents web  → Redis website → Agents worker → Supabase
Dashboard / profiling UI poll Supabase for status (not Celery results).
```

## Implementation overview

### Shared Redis

- Repo root [`docker-compose.yml`](../docker-compose.yml): Redis 7 Alpine on `localhost:6379`
- Both services use `REDIS_URL=redis://localhost:6379/0`

### Backend (`scrape`)

- [`Backend/app/celery_app.py`](../Backend/app/celery_app.py)
- [`Backend/app/tasks/pipeline.py`](../Backend/app/tasks/pipeline.py) — `pipeline.run_competitor`
- [`Backend/app/services/enqueue.py`](../Backend/app/services/enqueue.py)
- Route [`avatars.py`](../Backend/app/api/routes/avatars.py) fans out one task per competitor; returns `202`
- Health: `GET /health` includes `"redis": "up"|"down"` (503 when down)

### Agents (`website`)

- [`Agents/backend/celery_app.py`](../Agents/backend/celery_app.py)
- [`Agents/backend/tasks/profiling.py`](../Agents/backend/tasks/profiling.py) — `profiling.run_summarize`
- [`Agents/backend/services/enqueue_profiling.py`](../Agents/backend/services/enqueue_profiling.py)
- `POST /api/profiling/summarize` returns `202`; frontend polls avatar status columns
- Health: `GET /api/health` includes `"redis": "up"|"down"` (503 when down)

## Celery settings (parity — both apps)

| Setting | Value |
| --- | --- |
| Serializers | JSON only |
| `task_ignore_result` | `True` |
| `task_acks_late` | `True` |
| `task_reject_on_worker_lost` | `True` |
| `worker_prefetch_multiplier` | `1` |
| `broker_connection_retry_on_startup` | `True` |

### Time limits (pinned)

| Service | Soft | Hard |
| --- | --- | --- |
| Backend scrape | 840 | 900 |
| Agents website | 300 | 360 |

### Rate limits

| Queue | Default |
| --- | --- |
| `scrape` | `10/m` (`CELERY_SCRAPE_RATE_LIMIT`) |
| `website` | `6/m` (`CELERY_WEBSITE_RATE_LIMIT`) |

## API

### Competitor scrape (unchanged contract)

```http
POST /avatars/{avatar_id}/competitors/scrape
→ 202 { "status": "queued", "competitor_ids": [...], "message": "..." }
```

Broker down → `500`.

### Profiling summarize

```http
POST /api/profiling/summarize
Authorization: Bearer <token>
{ "avatar_id": "...", "force": false }

→ 202 { "status": "queued", "avatar_id": "...", "message": "..." }
```

Frontend polls `avatars.profile_summary_status` until `completed` / `failed`.

## Environment

Documented in `Backend/.env.example` and `Agents/backend/.env.example`.

### Supabase pooling checklist

This design runs **four** processes against Supabase (Backend web + scrape worker + Agents web + website worker). Before production:

1. Use Supabase’s **pooled** connection / project URL on all four processes (Dashboard → Database → connection pooling).
2. Do not use a direct session-mode URL that exhausts under concurrent workers.
3. Same `SUPABASE_URL` + service-role key on web and workers for each service.

## Local runbook

```bash
# From repo root
docker compose up -d

# Backend
cd Backend && .venv/Scripts/activate   # or source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
# Linux / Railway (prefork): up to 2 competitor scrapes in parallel
celery -A app.celery_app worker --loglevel=info -Q scrape --concurrency=2
# Windows (prefork is unreliable): use threads so 2 scrapes run at once
# celery -A app.celery_app worker --loglevel=info -Q scrape --pool=threads --concurrency=2

# Agents
cd Agents/backend && .venv/Scripts/activate
uvicorn main:app --reload --host 127.0.0.1 --port 8001
celery -A celery_app worker --loglevel=info -Q website --concurrency=2
# Windows website worker:
# celery -A celery_app worker --loglevel=info -Q website --pool=threads --concurrency=2

# Frontend
cd Frontend && npm run dev
```

**Why Redis + Celery still matter:** FastAPI returns `202` immediately; each competitor is a separate queued task. Worker `--concurrency` (and pool) controls how many of those tasks run at once. Without Celery, the API would block on every scrape. Without concurrency > 1 (or multiple workers), queued tasks still run one-by-one.
## Production mapping

| Piece | Deploy |
| --- | --- |
| Redis | Hosted instance; passworded `REDIS_URL` on all four processes |
| Backend | Procfile `web` + `worker` (`-Q scrape`) |
| Agents | Procfile `web` + `worker` (`-Q website`) |
| Uptime | Point checks at `GET /health` and `GET /api/health` |

## Chat rate limits (Agents invoke)

`POST /api/agents/invoke` uses Redis admission (not Celery):

- Keys: `agents:rl:{user_id}:global:m:{YYYYMMDDHHmm}`, `…:d:{YYYYMMDD}`, `…:inflight` (SET of server tokens)
- Defaults: 15/min, 150/UTC-calendar-day, 1 inflight stream
- Atomic Lua: concurrent reject does not burn minute/day quota
- Inflight SET has a shared safety TTL (default 900s) refreshed ~every 30s while SSE is alive
- Redis down → HTTP 503 fail-closed; quota/concurrent → 429 with `detail.error` / `Retry-After` for minute/day
- Known limitation: if the process dies after admit but before the SSE generator runs, the inflight slot relies on the safety TTL

## Security

- JWT + ownership before enqueue; workers re-validate owned rows
- Task payloads: IDs only (`avatar_id`, `competitor_id`, `force`)
- No pickle; no Redis secrets in frontend
- Health endpoints never echo Redis passwords
- Redis locks: `pipeline:competitor:{id}`, `profiling:avatar:{id}`
- Apify clients send the API token via `Authorization: Bearer` (not `?token=`), so httpx logs do not print secrets

## Known limitations

- Agents Celery rebinds `Agents/backend` onto `sys.path` / `PYTHONPATH` at worker init and task start — Celery can rewrite `sys.path` after boot, which previously caused `ModuleNotFoundError: agents` on deferred imports
- On Windows local, prefer `--pool=threads --concurrency=2` for parallel competitor scrapes (avoid `--pool=solo`, which is strictly sequential). Prefork remains the default on Linux/Railway via Procfile.
- Stop research still cooperative via `cancel_requested` (cannot abort mid-Apify actor)
- Celery does not raise Apify/OpenRouter quotas — tune concurrency and rate limits
- Eager Celery mode is pytest-only; never set in `.env`

## Future improvements

- Embedding backfill on `website` queue
- Flower / metrics dashboards
