# ContOS Agents

Phase 2 agent architecture for ContOS (fractional CMO / Marketing-as-a-Service).

**Full documentation:** [docs/AGENTS.md](docs/AGENTS.md)

## Quick start

1. Run `sql/001_agent_tables.sql` in Supabase (optional: `002_rls_policies.sql`).
2. Configure `backend/.env` (use Supabase **secret** key + OpenRouter key).
3. Backend: `cd backend && pip install -r requirements.txt && uvicorn main:app --reload --host 127.0.0.1 --port 8001`
4. Frontend: `cd frontend && npm install && npm run dev` → http://127.0.0.1:5173/
5. Optional: `POST /api/embeddings/store-playbooks` to seed playbook vectors.
