# Phase 5 — Dashboard UI

## Purpose

Give users a command center to switch projects, track competitor pipeline progress live, read AI summaries as they complete, and add more competitors without recreating a project.

## Layout

```text
┌─────────────────────────────────────────────────────────┐
│ Header (ContOS · sign out)                              │
├──────────────┬──────────────────────────────────────────┤
│ Sidebar      │ Main content                             │
│ · Projects   │ · Project title + status                 │
│ · Competitors│ · Add competitor panel (when open)       │
│ · Add button │ · Per-competitor progress OR summary     │
└──────────────┴──────────────────────────────────────────┘
```

## Features

| Feature | Implementation |
| --- | --- |
| Project switcher | [`DashboardSidebar.tsx`](../Frontend/src/components/dashboard/DashboardSidebar.tsx) links to `/dashboard/:projectId` |
| Competitor list | Sidebar lists competitors for active project with status hint |
| Add competitor | [`AddCompetitorPanel.tsx`](../Frontend/src/components/dashboard/AddCompetitorPanel.tsx) — Overview workspace panel; same validation as Phase 3; enqueues scrape for new IDs only |
| 10-competitor cap | Button disabled with tooltip when `MAX_COMPETITORS_PER_AVATAR` reached |
| Progress cards | [`CompetitorProgressCard.tsx`](../Frontend/src/components/dashboard/CompetitorProgressCard.tsx) — step tracker: Queued → Scraping → Transcribing → Analyzing → Done |
| Failed state | `error_message` shown inline on progress card |
| Summary display | [`CompetitorSummaryCard.tsx`](../Frontend/src/components/dashboard/CompetitorSummaryCard.tsx) remains in codebase; Overview does not render summaries (Analytics route retired) |
| Live updates | [`useDashboardPolling.ts`](../Frontend/src/hooks/useDashboardPolling.ts) polls Supabase every 5s |

## Pipeline step copy

Mapped in [`pipeline.ts`](../Frontend/src/lib/pipeline.ts):

| `pipeline_step` | User-facing label |
| --- | --- |
| `queued` | Queued |
| `scraping` | Researching competitors |
| `transcribing` | Transcribing reels |
| `analyzing` | Analyzing content |
| `done` | Done |
| `failed` | Failed |

## Data sources (client-side)

All reads use Supabase anon key + user JWT (RLS):

- `projects` — project list and status
- `competitors` — pipeline progress fields
- `content_summaries` — structured LLM JSON per competitor

Scrape enqueue still goes through FastAPI (`POST /projects/{id}/competitors/scrape`).

## Summary JSON rendered

From `content_summaries.summary`:

- Top performing content (with `content_type`, metrics, why it performed)
- Recurring hooks & patterns
- Content strategies & themes
- Aggregated engagement metrics (`total_content_count`, breakdown by type)
- Strategic signals

## Manual test

1. Start backend (`uvicorn`) and frontend (`npm run dev`)
2. Open `/dashboard/:projectId` for a project with competitors
3. Confirm progress cards update as `pipeline_step` changes (poll every 5s)
4. When a competitor completes, summary card replaces progress card
5. Add a competitor from sidebar — confirm new row appears and scrape enqueues
6. At 10 competitors, confirm Add button is disabled

## Known limitations

- Polling only (no Supabase Realtime subscription yet)
- Main area shows one selected competitor at a time (sidebar selection)
- Mixed project status (`failed` + `completed` competitors) reflected at project level only
