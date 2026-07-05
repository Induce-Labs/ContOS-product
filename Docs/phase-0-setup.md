# Phase 0 — Project Setup

## Purpose

Bootstrap the ContOS v1 monorepo: React frontend, FastAPI backend, Supabase connection, local dev wiring, and `pgvector` enabled for future embeddings.

## Architecture

```text
Frontend/          React + Vite + Tailwind + @supabase/supabase-js
Backend/           Python FastAPI (port 8000)
Supabase           Auth + Postgres (project: aoaoloxnzhvyvvdjcbcr)
```

Frontend talks to Supabase directly for auth/data (Phase 2+). Pipeline orchestration calls the FastAPI backend via `VITE_API_BASE_URL`.

## Environment variables

### Frontend (`Frontend/.env.local` — gitignored)

| Variable | Description |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (publishable) key |
| `VITE_API_BASE_URL` | FastAPI base URL (`http://localhost:8000`) |

Copy from `Frontend/.env.example` and fill in real values.

### Backend (`Backend/.env` — gitignored)

| Variable | Description | Required in Phase 0 |
| --- | --- | --- |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin key | No (Phase 4) |
| `APIFY_API_TOKEN` | Apify scraping | No (Phase 4) |
| `OPENROUTER_API_KEY` | Dev LLM summarization | No (Phase 4) |
| `OPENAI_API_KEY` | Production LLM | No (Phase 4) |
| `CORS_ORIGINS` | Allowed frontend origins | Yes |

Copy from `Backend/.env.example`. Never expose the service-role key or third-party API keys to the frontend.

## Local development

### Backend

```bash
cd Backend
py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1   # Windows
pip install -e .
uvicorn app.main:app --reload --port 8000
```

Health: http://localhost:8000/health

### Frontend

```bash
cd Frontend
npm install
npm run dev
```

App: http://localhost:5173 — shows backend health status via CORS fetch.

## Supabase

- Project URL: `https://aoaoloxnzhvyvvdjcbcr.supabase.co`
- `pgvector` extension enabled in schema `extensions` (migration: `enable_pgvector_extension`)

## Security

- Anon key is used client-side only via `.env.local`
- Service-role, Apify, and LLM keys are backend-only
- CORS restricts API access to local frontend origins

## Known limitations (Phase 0)

- No auth UI, database tables, or pipeline endpoints yet (Phases 1–4)
- Backend service-role and third-party keys are placeholders until pipeline work begins

## Future improvements

- Phase 1: database schema + RLS
- Phase 2: Supabase Auth screens
- Phase 4: scrape/summarize pipeline endpoints
