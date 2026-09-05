# Phase 3 — Project Creation Flow

## Purpose

Let authenticated users create a project, add 1–10 Instagram competitors, persist records in Supabase, enqueue scrape jobs on the FastAPI backend, and redirect immediately to the dashboard.

## User flow

1. User clicks **New project** (dashboard empty state or header)
2. **Step 1:** Enter project name + select Personal Branding or Business
3. **Step 2:** Add Instagram competitor handles/URLs (recommended 5, min 1, max 10)
4. On submit:
   - Insert `competitors` rows (`scrape_status: pending`, `pipeline_step: queued`)
   - Reuse any same handle/URL already on the avatar (idempotent retry after a prior partial submit)
   - Enqueue scrape for returned competitor IDs (new + reused)
   - Redirect to dashboard without waiting for pipeline completion

## Frontend files

| File | Role |
| --- | --- |
| `Frontend/src/pages/NewProjectPage.tsx` | Two-step wizard |
| `Frontend/src/lib/projects.ts` | `createProject`, `updateProjectStatus` |
| `Frontend/src/lib/competitors.ts` | `createCompetitors`, limits |
| `Frontend/src/lib/instagram.ts` | URL/handle validation + deduplication |
| `Frontend/src/lib/api.ts` | Background scrape enqueue |

## API endpoint (stub — Phase 4 implements pipeline)

```
POST /projects/{project_id}/competitors/scrape
Content-Type: application/json

{
  "competitor_ids": ["uuid", "..."]
}

Response 202:
{
  "status": "queued",
  "competitor_ids": ["..."],
  "message": "..."
}
```

Implemented in `Backend/app/api/routes/projects.py`. Returns 202 immediately; actual Apify + LLM work ships in Phase 4.

## Validation rules

- Project name: required, non-empty after trim
- Project type: `personal_branding` | `business`
- Competitors: 1–10 Instagram entries only (Twitter/Reddit hidden in v1)
- Accepts `@handle`, `handle`, or `https://instagram.com/handle/`
- Rejects post/reel/explore URLs and duplicate handles

## Security

- All Supabase writes use the authenticated user's JWT; RLS enforces ownership
- Scrape enqueue is non-blocking; failures are logged client-side but do not block redirect
- Service-role key is not used on the frontend

## Manual test plan

1. Sign in → dashboard empty state → **New project**
2. Complete wizard with 1–3 valid Instagram competitors
3. Confirm redirect to `/dashboard/:projectId`
4. Verify rows in Supabase `projects` and `competitors` tables
5. Confirm backend receives `POST .../scrape` (202) if backend is running

## Known limitations

- Pipeline stub does not scrape yet (Phase 4)
- Dashboard does not show progress cards yet (Phase 5)
- "Add more competitors" from existing project ships with Phase 5 sidebar
