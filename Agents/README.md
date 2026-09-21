# ContOS Agents

Phase 2 agent architecture for ContOS (fractional CMO / Marketing-as-a-Service).

**Full documentation:** [docs/AGENTS.md](docs/AGENTS.md)

## Quick start

1. Run `sql/001_agent_tables.sql` in Supabase (optional: `002_rls_policies.sql`).
2. Configure `backend/.env` (use Supabase **secret** key + OpenRouter key + `REDIS_URL`). Use a **pooled** Supabase URL in production (web + Celery worker).
3. Start Redis from repo root: `docker compose up -d`
4. Backend API: `cd backend && pip install -r requirements.txt && uvicorn main:app --reload --host 127.0.0.1 --port 8001`
5. Celery website worker: `celery -A celery_app worker --loglevel=info -Q website --concurrency=2`
6. Frontend: `cd frontend && npm install && npm run dev` → http://127.0.0.1:5173/
7. Optional: `POST /api/embeddings/store-playbooks` to seed playbook vectors.

Profiling summarize returns `202` and runs on the `website` queue. See [`Docs/phase-celery.md`](../Docs/phase-celery.md).

## Marketing knowledge demo corpus

`Transcripts.docx` can be ingested as source-grounded RAG material for the platform agents. Apply
`supabase/migrations/20260921120000_marketing_knowledge_chunks.sql` first, then from `Agents/backend`:

```bash
# Inspect chunks only (no embedding API calls or database writes)
python scripts/ingest_marketing_knowledge.py ../Transcripts.docx --dry-run

# Embed and replace this document's existing chunks
python scripts/ingest_marketing_knowledge.py ../Transcripts.docx
```

The ingestion command requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`OPENROUTER_API_KEY` in `Agents/backend/.env`. `NEXT_PUBLIC_*` variables and a
Supabase publishable key are browser configuration and are not used by this Python service.
