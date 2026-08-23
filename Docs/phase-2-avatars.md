# Phase 2 — Avatars + Profiling + Strategy Context

## Purpose

Make **Avatar** the persistent context boundary for ContOS. An Avatar is an `avatars` row (`avatar_id` scopes competitors, scrape, summaries, and RAG).

## Architecture

```text
User
 └── avatars
      ├── profiling_data (JSONB answers keyed by question_key)
      ├── competitors → scrape → instagram_content_summaries / linkedin_content_summaries
      └── Agents chat → Avatar resolution → profile + RAG → Strategist
```

## Database

Migrations:

- [`supabase/migrations/20260822120000_avatar_profiling.sql`](../supabase/migrations/20260822120000_avatar_profiling.sql)
- [`supabase/migrations/20260823120000_rename_tables_for_clarity.sql`](../supabase/migrations/20260823120000_rename_tables_for_clarity.sql) (projects → avatars, Instagram table prefixes)
- [`supabase/migrations/20260823140000_profiling_data_jsonb_only.sql`](../supabase/migrations/20260823140000_profiling_data_jsonb_only.sql) (drop `avatar_profiling_responses`)

| Object | Role |
| --- | --- |
| `avatars.profiling_data` | `{question_key: answer}` JSONB — source of truth for profiling |
| `avatars.profiling_completeness` | 0–100, **server-owned** (trigger on `profiling_data` update) |
| `avatars.is_default` | One default avatar per user |
| `profiling_questions` | DB-driven questions per `personal_branding` / `business` |
| `set_default_avatar(uuid)` | RPC with ownership check |
| Avatar cap trigger | Basic plan `max_avatars = 3` (`AVATAR_LIMIT_REACHED`) |

RLS: questions readable by authenticated users; responses via avatar ownership.

## Profiling flow

1. Select type → name Avatar
2. Answer questions from `profiling_questions`
3. Merge each answer into `avatars.profiling_data` → trigger updates `profiling_completeness`
4. Add competitors → Apify pipeline

## Chat / Agents

Invoke body:

```json
{
  "avatar_id": "...",
  "tagged_avatar_ids": ["uuid", "..."]
}
```

Resolution (`Agents/backend/context/avatar_resolve.py`):

1. Tagged IDs (must be owned) → else active `avatar_id` → else `is_default` → else empty

Context (`Agents/backend/context/avatar_context.py`):

- Load `profiling_data` per avatar
- RAG via `similarity_search` / `fetch_summaries` scoped by `avatar_id`
- Multi-avatar → multi-context prompt path

## Legacy `profiles` table

Removed in Aug 2026. Pre-Avatar brand profiles (one row per user) were merged into the user's default avatar `profiling_data` before drop. Agents use `avatars.profiling_data` only.

## Frontend

- Supabase CRUD: `Frontend/src/lib/avatars.ts`, `profiling.ts`
- Scrape API: `POST /avatars/{avatar_id}/competitors/scrape` (Backend `:8000`)

## Security

- All avatar-scoped data gated by RLS on `avatars.user_id = auth.uid()`
- Agents invoke validates `avatar_id` ownership before streaming
- Profiling completeness is server-owned (Postgres trigger); clients write `profiling_data` only

## Known limitations

- URL routes still use `/dashboard/:projectId` param name (UUID is the avatar id)
- `agent_calls.avatar_id` remains `text` (optional future: normalize to uuid)
