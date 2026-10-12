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
- [`Agents/backend/tasks/translate.py`](../Agents/backend/tasks/translate.py) — `translate.translate_content` (cache warm / batch)
- [`Agents/backend/services/enqueue_profiling.py`](../Agents/backend/services/enqueue_profiling.py)
- [`Agents/backend/services/enqueue_translate.py`](../Agents/backend/services/enqueue_translate.py)
- `POST /api/profiling/summarize` returns `202`; frontend polls avatar status columns
- `POST /api/translate` runs in-process `translate_batch` (JWT); see [phase-i18n.md](./phase-i18n.md)
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
celery -A app.celery_app worker --loglevel=info -Q scrape --concurrency=2 -n scrape@%h
# Windows (prefork is unreliable): use threads so 2 scrapes run at once
# celery -A app.celery_app worker --loglevel=info -Q scrape --pool=threads --concurrency=2 -n scrape@%h

# Agents
cd Agents/backend && .venv/Scripts/activate
uvicorn main:app --reload --host 127.0.0.1 --port 8001
celery -A celery_app worker --loglevel=info -Q website --concurrency=2 -n website@%h
# Windows website worker:
# celery -A celery_app worker --loglevel=info -Q website --pool=threads --concurrency=2 -n website@%h

# Frontend
cd Frontend && npm run dev
```

**Node names:** always pass unique `-n scrape@%h` / `-n website@%h`. Multiple workers with the same default name (`celery@hostname`) steal jobs into Redis `unacked` and leave competitors stuck on `pending`/`queued`.

**Why Redis + Celery still matter:** FastAPI returns `202` immediately; each competitor is a separate queued task. Worker `--concurrency` (and pool) controls how many of those tasks run at once. Without Celery, the API would block on every scrape. Without concurrency > 1 (or multiple workers), queued tasks still run one-by-one.

**Orphan recovery:** if Redis is flushed or workers die, Supabase rows can stay `pending` while no Celery message exists. The dashboard re-enqueues those orphans once per browser session (after ~90s age). Manual **Retry** on a competitor card still works anytime.
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
- If admit hits `concurrent`, the server clears that user's inflight SET once and re-admits (preempts zombie streams left when a tab was backgrounded)
- Agent generation runs in a **producer thread** decoupled from the SSE consumer — backgrounding/closing the tab does not abort the LLM; results are stored in Redis under `run_id` (`agents:run:{id}`, TTL 1h)
- First SSE `status` event includes `run_id`; `GET /api/agents/runs/{run_id}` lets the UI catch up when the tab becomes visible again
- Frontend also persists `{runId,assistantId,projectId}` in `sessionStorage` and polls every 2s / on focus — so Chrome tab discard or a full reload can still hydrate the answer
- Redis down → HTTP 503 fail-closed; quota/concurrent → 429 with `detail.error` / `Retry-After` for minute/day
- Known limitation: if the process dies after admit but before the producer starts, the inflight slot relies on the safety TTL
- Frontend retries `concurrent_limit` briefly so a just-released slot does not brick the next send after a tab switch

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

## GlitchTip error monitoring

ContOS reports unexpected application errors to GlitchTip. The clients are the official Sentry-compatible SDKs (`sentry-sdk` on Python, `@sentry/react` in the browser). The DSNs point at GlitchTip projects. No Sentry hosted account is required, and no GlitchTip or Sentry auth token is read at runtime.

| Process | Project | Variable |
| --- | --- | --- |
| Frontend | contos-frontend | `VITE_SENTRY_DSN`, `VITE_SENTRY_ENVIRONMENT` |
| Backend web and scrape worker | contos-backend | `SENTRY_DSN`, `SENTRY_ENVIRONMENT` |
| Agents web and website worker | contos-agents | `SENTRY_DSN`, `SENTRY_ENVIRONMENT` |

- Init runs only when the DSN is set. An empty DSN leaves the process running with monitoring off.
- `SENTRY_ENVIRONMENT` / `VITE_SENTRY_ENVIRONMENT` is `production` or `development`.
- Set each service's own DSN. Agents loads `Backend/.env` when that file is present, and a blank Agents `SENTRY_DSN` does not override it, so a local Agents process can otherwise publish into the backend GlitchTip project.
- Sessions are disabled because GlitchTip does not support them (`auto_session_tracking=False` on Python; the browser SDK omits the session integration). Transaction sample rate is `0.01`. Log ingestion is off.
- Expected client statuses 400, 401, 403, 404, 409, 410, and 429 are not sent. Unexpected 500, 502, 503, and 504 responses are.
- Celery task failures on `pipeline.run_competitor`, `profiling.run_summarize`, and `translate.translate_content` are captured. Task args and kwargs are removed before send. Safe tags are limited to ids already on the task (`avatar_id`, `competitor_id`, `user_id`).
- Request headers, cookies, and bodies are removed. Secret patterns (Bearer, `pos_` tokens, OAuth values, credential URLs, provision and encryption key names) are redacted.
- Postiz itself is not monitored. GlitchTip only sees ContOS failures while talking to Postiz.
- Host and VPS monitoring remain a future phase. Health endpoints are unchanged.

## Local Flower (development only)

Flower watches both workers from one process because they share `redis://localhost:6379/0`. It is not part of the Railway deploy: it is not in `requirements.txt` or either Procfile, and it is not bound to a public interface.

- Package: Flower 2.2.0, installed only in `Backend/.venv`.
- Local workers add `-E` on the process command so task events are on. `celery_app.py` is unchanged (`worker_send_task_events` is not set there).
- One Flower process uses the Backend Celery app and the shared broker.
- Listen address is `127.0.0.1:5555` only.
- Basic auth comes from `FLOWER_BASIC_AUTH` in gitignored `Backend/.env` (`username:password`). Flower reads `FLOWER_*` environment variables. Do not commit the password or pass it on the command line.
- `task_ignore_result` stays `True`, so Flower has no stored return value. With events enabled it still shows state, runtime, worker, and retries while Flower is running.
- Redis task events leave `routing_key` empty. The queue is the worker's queue: `scrape@…` consumes `scrape`, `website@…` consumes `website`.

Start the local workers with the existing flags plus `-E`, then start Flower from `Backend` after loading `FLOWER_BASIC_AUTH` into the process environment:

```powershell
.\.venv\Scripts\python.exe -m celery -A app.celery_app worker --loglevel=info -Q scrape --pool=threads --concurrency=2 -n scrape@%h -E
```

```powershell
.\.venv\Scripts\python.exe -m celery -A celery_app worker --loglevel=info -Q website --pool=threads --concurrency=2 -n website@%h -E
```

```powershell
$env:FLOWER_BASIC_AUTH = ((Get-Content .env | Where-Object { $_ -like 'FLOWER_BASIC_AUTH=*' }) -replace '^FLOWER_BASIC_AUTH=','').Trim()
.\.venv\Scripts\python.exe -m celery -A app.celery_app flower --address=127.0.0.1 --port=5555
```

Open `http://127.0.0.1:5555` on this machine. Unauthenticated requests receive 401.

## Future improvements

- Embedding backfill on `website` queue
- Production metrics dashboards (local Flower is development-only)
- Host and VPS monitoring
