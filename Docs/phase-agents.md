# Phase Agents — User-scoped chat (chat-first UX)

## Purpose

ContOS Agents turns scraped competitor memory into an interactive chatbot. After research completes, users are redirected to chat (not summary cards). Agents answer strategy/content questions using only the authenticated user’s project data.

## Architecture

```
Frontend (:5173)
  ├─ VITE_API_BASE_URL → scrape Backend (:8000)
  └─ VITE_AGENT_API_BASE_URL → Agents API (:8001)
       └─ JWT → project ownership → MCP tools → Supabase
```

- Scrape pipeline still writes `content_summaries` / `linkedin_content_summaries` as **agent memory**.
- Primary UX after scrape: `/dashboard/:projectId/agents` with a welcome prompt asking what the user wants.

## Avatar context (Phase 2)

- Avatar = `projects` row. Competitors/RAG remain scoped by `project_id`.
- Invoke may include `tagged_avatar_ids` (owned project UUIDs).
- Resolution: tagged → active project → `is_default` → empty.
- Profile prefers `projects.profiling_data`; see [`Docs/phase-2-avatars.md`](../Docs/phase-2-avatars.md).

## Auth & scoping

- `Authorization: Bearer <supabase_access_token>` required on invoke/ingest/admin routes.
- `user_id` is derived from the JWT (not trusted from the client body).
- `project_id` must belong to that user (`projects.user_id`).
- MCP tools filter summaries/posts by that `project_id` only (`cross_project` removed).
- Profile tool never falls back to another user’s profile.

## Local run

Five processes (Redis + scrape API/worker + Agents API/worker + frontend):

```bash
# Terminal 0 — Redis (repo root)
docker compose up -d

# Terminal 1 — scrape Backend
cd Backend && uvicorn app.main:app --reload --port 8000

# Terminal 2 — scrape Celery worker
cd Backend && celery -A app.celery_app worker --loglevel=info -Q scrape

# Terminal 3 — Agents
cd Agents/backend && uvicorn main:app --reload --host 127.0.0.1 --port 8001

# Terminal 4 — Agents Celery website worker
cd Agents/backend && celery -A celery_app worker --loglevel=info -Q website

# Terminal 5 — Frontend
cd Frontend && npm run dev
```

See [`Docs/phase-celery.md`](./phase-celery.md).

Frontend env:

```
VITE_API_BASE_URL=http://localhost:8000
VITE_AGENT_API_BASE_URL=http://localhost:8001
```

Agents env: copy [`Agents/backend/.env.example`](../Agents/backend/.env.example) → `.env` (same Supabase project + OpenRouter key as Backend).

## API

```
POST /api/agents/invoke
Authorization: Bearer <token>
Body: { project_id, agent_type, user_input, chatbot_context_on? }
→ text/event-stream (status | token | complete | error)
```

`agent_type`: `chatbot` | `linkedin` | `instagram` | `playbook` (twitter exists but ContOS UI focuses on LI/IG).

## Security notes

- Embedding/backfill routes require JWT; in `LLM_ENV=prod` also require `AGENTS_ADMIN_USER_IDS`.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
- Agents demo UI under `Agents/frontend` is optional/local only.

## Known limitations

- Agents does not run Apify; research must already exist for the project.
- Auto-redirect to chat fires once when a project becomes ready (retry resets the guard).
