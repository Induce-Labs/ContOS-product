# Phase 1 — Database Schema

## Purpose

Define the ContOS v1 Postgres schema in Supabase with Row Level Security (RLS) so each authenticated user can only access their own projects, competitors, scraped content, and summaries.

## Tables

| Table | Description |
| --- | --- |
| `projects` | User-owned workspace (name, type, status) |
| `competitors` | Social profiles tracked per project |
| `scraped_content` | Raw reel data per competitor (idempotent on `competitor_id` + `external_id`) |
| `content_summaries` | Structured LLM output per competitor |

## Entity relationships

```text
auth.users
    └── projects (user_id)
            ├── competitors (project_id)
            │       └── scraped_content (competitor_id)
            └── content_summaries (project_id, competitor_id)
```

## Key constraints

- `projects.type`: `personal_branding` | `business`
- `projects.status`: `onboarding` | `scraping` | `ready` | `failed`
- `competitors.platform`: `instagram` | `twitter` | `reddit`
- `competitors.scrape_status`: `pending` | `in_progress` | `completed` | `failed`
- `competitors.pipeline_step`: `queued` | `scraping` | `analyzing` | `done` | `failed`
- `scraped_content`: unique (`competitor_id`, `external_id`) for idempotent re-scrapes
- `content_summaries.embedding`: nullable `extensions.vector(1536)` for future MLOps

## Row Level Security

RLS is enabled on all four tables. Policies enforce:

- **`projects`**: `user_id = auth.uid()`
- **`competitors`**: project belongs to `auth.uid()`
- **`scraped_content`**: competitor's project belongs to `auth.uid()`
- **`content_summaries`**: `project_id` belongs to `auth.uid()`

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
