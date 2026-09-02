# Phase 1 — Database Schema

## Schema rename (Aug 2026)

For clarity, core tables were renamed:

| Old name | New name |
| --- | --- |
| `projects` | `avatars` |
| `project_id` (FK columns) | `avatar_id` |
| `scraped_content` | `instagram_scraped_content` |
| `content_summaries` | `instagram_content_summaries` |
| `profiles` | **removed** (legacy; merged into `avatars.profiling_data`) |

Migration: `supabase/migrations/20260823120000_rename_tables_for_clarity.sql`

## Purpose

Define the ContOS v1 Postgres schema in Supabase with Row Level Security (RLS) so each authenticated user can only access their own avatars, competitors, scraped content, and summaries.

## Tables

| Table | Description |
| --- | --- |
| `avatars` | User-owned Avatar/workspace (name, type, status, profiling_data, is_default) |
| `profiling_questionnaires` | Avatar profiling questionnaires (JSONB; Phase 2) |
| `avatars.profile_summary` | LLM-generated chatbot context summary (Phase 2 onboarding) |
| `avatars.website_summary` | LLM summary of optional `website_url` via Apify Website Content Crawler |
| `avatars.website_summary_*` | Status / URL / hash / error columns (service_role write-only, same guard as profile_summary) |
| `avatar_profiling_responses` | **removed** — answers live in `avatars.profiling_data` |
| `competitors` | Social profiles tracked per avatar |
| `instagram_scraped_content` | Raw Instagram reel/post data per competitor |
| `instagram_content_summaries` | Structured LLM output for Instagram per competitor |
| `linkedin_scraped_content` | Raw LinkedIn posts per competitor |
| `linkedin_content_summaries` | Structured LLM output for LinkedIn per competitor |

## Entity relationships

```text
auth.users
    └── avatars (user_id)
            ├── competitors (avatar_id)
            │       ├── instagram_scraped_content (competitor_id)
            │       └── linkedin_scraped_content (competitor_id)
            ├── instagram_content_summaries (avatar_id, competitor_id)
            └── linkedin_content_summaries (avatar_id, competitor_id)
```

## Key constraints

- `avatars.type`: `personal_branding` | `business`
- `avatars.status`: `onboarding` | `scraping` | `ready` | `failed`
- `competitors.platform`: `instagram` | `twitter` | `reddit` | `linkedin`
- `competitors.scrape_status`: `pending` | `in_progress` | `completed` | `failed`
- `competitors.pipeline_step`: `queued` | `scraping` | `transcribing` | `analyzing` | `done` | `failed`
- `instagram_scraped_content`: unique (`competitor_id`, `external_id`) for idempotent re-scrapes
- `instagram_scraped_content.post_url`: canonical Instagram link (transcriber input)
- `instagram_scraped_content.transcription_status`: `pending` | `in_progress` | `completed` | `failed` | `not_applicable`
- Summary tables: nullable `extensions.vector(1536)` embeddings for agent RAG

## Row Level Security

RLS is enabled on all tables. Policies enforce:

- **`avatars`**: `user_id = auth.uid()`
- **`competitors`**: avatar belongs to `auth.uid()`
- **`instagram_scraped_content` / `linkedin_scraped_content`**: competitor's avatar belongs to `auth.uid()`
- **Summary tables**: `avatar_id` belongs to `auth.uid()`

The FastAPI backend uses the **service-role key**, which bypasses RLS for pipeline writes. The frontend uses the **anon key** with the user's JWT and is subject to RLS.

## Migrations

Local SQL files in `supabase/migrations/`:

1. `20260705111516` — `enable_pgvector_extension` (Phase 0)
2. `20260705120000` — `create_contos_schema`
3. `20260705120100` — `fix_function_search_paths`

Apply to remote via Supabase MCP or Supabase CLI.

## Frontend types

Generated Supabase types live at `Frontend/src/types/database.ts`. Domain enums are in `Frontend/src/types/contos.ts`. Regenerate after schema changes:

```bash
# Via Supabase MCP tool: generate_typescript_types
```

## Manual RLS test procedure

Requires two test user accounts (User A and User B) signed up via Supabase Auth.

1. Sign in as **User A** in the app (or Supabase SQL editor with `auth.uid()` set via JWT).
2. Insert a project for User A.
3. Confirm User A can `SELECT` their project.
4. Sign in as **User B**.
5. Attempt `SELECT` on User A's project ID — expect **0 rows**.
6. Repeat for `competitors`, `scraped_content`, and `content_summaries` child rows.

**Quick SQL check (service role / SQL editor):**

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

Expected: 4 policies per table (SELECT, INSERT, UPDATE, DELETE) = 16 total.

## Security review

- RLS enabled on all user-facing tables
- Trigger functions use `SET search_path = public`
- Service-role key remains backend-only
- No secrets in migration files

## Known limitations

- Enum values enforced via `CHECK` constraints, not Postgres `ENUM` types (easier to extend in v2)
- RLS cross-user test requires manual auth setup (two real users)
- `embedding` column unused until future MLOps work

## Future improvements

- Phase 2: Auth UI writes to `projects` via typed Supabase client
- Phase 4: Backend pipeline writes via service-role client
- Add database-level competitor cap (10 per project) via trigger or RPC
