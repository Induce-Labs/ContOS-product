# ContOS v1 — TODO / Build Checklist

> Companion to `prd.md`. Organized in build order — each phase mostly unblocks the next, though some frontend/backend work can happen in parallel once the schema (Phase 1) is in place.
> 

---

## Phase 0 — Project Setup

- [x]  Init frontend app: **ReactJS + Tailwind CSS**
- [x]  Init backend app: **Python + FastAPI** (runs locally on **port 8000**)
- [x]  Create Supabase project (Auth + Postgres)
- [x]  Set up env vars / secrets management for both apps:
    - [x]  Frontend: Supabase URL + anon key
    - [x]  Backend: Supabase URL + **service-role key** (server-side only, never shipped to frontend)
    - [x]  Backend: Apify API token
    - [x]  Backend: OpenRouter API key (dev/testing)
    - [x]  Backend: OpenAI API key (production)
- [x]  Decide local dev setup (how frontend talks to local FastAPI, CORS config, etc.)
- [x]  Enable `pgvector` extension in Supabase (even though unused in v1, per schema plan)

---

## Phase 1 — Database Schema (Supabase / Postgres)

- [x]  Create `projects` table
    - `id`, `user_id`, `name`, `type`, `status`, `created_at`, `updated_at`
- [x]  Create `competitors` table
    - `id`, `project_id`, `platform`, `handle_or_url`, `scrape_status`, `pipeline_step`, `last_scraped_at`, `error_message`, `created_at`
- [x]  Create `scraped_content` table
    - `id`, `competitor_id`, `platform`, `content_type`, `external_id`, `posted_at`, `likes`, `views`, `shares`, `comments_count`, `caption`, `transcript`, `transcript_source`, `raw_payload` (jsonb), `scraped_at`
    - [x]  Add uniqueness constraint on (`competitor_id`, `external_id`) to keep re-scrapes idempotent
- [x]  Create `content_summaries` table
    - `id`, `competitor_id`, `project_id`, `summary` (jsonb), `model_used`, `generated_at`, `embedding` (nullable vector column)
- [x]  Write and apply RLS policies for all 4 tables:
    - [x]  `projects`: user can only access rows where `user_id = auth.uid()`
    - [x]  `competitors`, `scraped_content`, `content_summaries`: user can only access rows whose `project_id` (directly or via join) belongs to a project they own
- [x]  Seed/test data + manual RLS test (confirm user A cannot read user B's rows)

---

## Phase 2 — Auth (Frontend + Supabase)

- [x]  Set up Supabase Auth client in React app
- [x]  Build Sign Up screen (email/password + "Sign up with Google")
- [x]  Build Log In screen (email/password + "Sign in with Google")
- [x]  Configure Google OAuth provider in Supabase Auth settings (client ID/secret, redirect URLs)
- [x]  Handle session persistence + protected routes (redirect unauthenticated users to login)
- [x]  Post-authentication redirect logic:
    - [x]  If user has no projects → show "Create your first project" empty state
    - [x]  If user has ≥1 project → land on dashboard (last-used or first project)

---

## Phase 3 — Project Creation Flow (Frontend)

- [ ]  "New Project" entry point (button on empty state / projects list)
- [ ]  Project creation step:
    - [ ]  Text input for **project name** (required)
    - [ ]  Selector: **Personal Branding** vs **Business** (required)
- [ ]  Competitor intake form:
    - [ ]  Instagram link/handle input, supports adding multiple
    - [ ]  Enforce **min 1, recommended 5 (shown as guidance text), max 10**
    - [ ]  Basic validation: valid Instagram URL/handle format
    - [ ]  Instagram-only field(s); Twitter/Reddit inputs are **hidden entirely** in v1 (not shown, not disabled)
- [ ]  On submit:
    - [ ]  Create `project` row in Supabase
    - [ ]  Create `competitor` rows in Supabase (status defaults: `scrape_status = pending`, `pipeline_step = queued`)
    - [ ]  Call FastAPI endpoint to kick off the scrape/summarize pipeline for these competitors
    - [ ]  Redirect to Dashboard **immediately** (do not block on pipeline call)

---

## Phase 4 — FastAPI Backend: Pipeline Orchestration

- [ ]  Define API contract: endpoint(s) the frontend calls to enqueue competitor scrape jobs
    - e.g. `POST /projects/{project_id}/competitors/scrape` accepting a list of competitor IDs
- [ ]  Implement async job handling (FastAPI background tasks, or Celery/RQ — resolve Open Question 4 first)
- [ ]  Per-competitor pipeline function:
    - [ ]  Set `pipeline_step = scraping`, `scrape_status = in_progress`
    - [ ]  Call **Instagram post scraper — apify** for the competitor's handle/URL (gets posts + reels)
    - [ ]  Filter results: **Reels only**, **posted within last 30 days**
    - [ ]  Parse and write rows to `scraped_content` (likes, views, shares, comments_count, caption, transcript, raw_payload)
    - [ ]  Generate transcripts via **tictechid/anoxvanzi-Transcriber** — **no Whisper/transcription step**
    - [ ]  Set `pipeline_step = analyzing`
    - [ ]  Build GPT-4o prompt from the scraped batch (captions + transcripts + metrics)
    - [ ]  Dev/testing: call OpenRouter (free) with structured JSON output/schema enforcement
    - [ ]  Production: call OpenAI GPT-4o with structured JSON output/schema enforcement
    - [ ]  Write result to `content_summaries` (summary jsonb, model_used, generated_at)
    - [ ]  Set `pipeline_step = done`, `scrape_status = completed`, `last_scraped_at = now()`
- [ ]  Error handling:
    - [ ]  Wrap each competitor's pipeline so one failure doesn't kill others in the same batch
    - [ ]  On failure: set `pipeline_step = failed`, `scrape_status = failed`, populate `error_message`
- [ ]  Idempotency: re-running a scrape for the same competitor shouldn't duplicate `scraped_content` rows (rely on the uniqueness constraint from Phase 1)
- [ ]  Support "add more competitors later" — endpoint/logic should work identically whether triggered from initial project creation or from the dashboard's "Add Competitor" action, and only process the newly added competitor(s)

---

## Phase 5 — Dashboard (Frontend)

- [ ]  Layout shell: **sidebar (left) + main content area (right)**
- [ ]  Sidebar:
    - [ ]  List user's projects, allow switching between them
    - [ ]  Once a project is selected, list its competitors
    - [ ]  "Add Competitor" action (opens same intake form as Phase 3, minus project creation)
    - [ ]  Disable/tooltip "Add Competitor" once a project hits the 10-competitor cap
- [ ]  Main content area:
    - [ ]  **Progress card** per competitor: step tracker (Queued → Scraping → Analyzing → Done), reflecting `pipeline_step`
    - [ ]  Inline failed-state UI showing `error_message` when a competitor's pipeline fails
    - [ ]  Live updates: implement polling or Supabase Realtime subscription on `competitors` (either approach is fine for v1)
    - [ ]  Use user-friendly step copy, not raw enum values — e.g. "Researching your competitors...", "Analyzing top content...", "Done" (map `pipeline_step` values to display strings)
    - [ ]  **Summary display**: once `content_summaries` exists for a competitor, render it (top-performing content, hooks, strategies, aggregated metrics) — replacing or sitting alongside that competitor's progress card
    - [ ]  Summaries should appear incrementally per competitor, not wait for the whole batch

---

## Phase 6 — Non-Functional / Hardening

- [ ]  Confirm no Supabase service-role key or OpenAI/Apify keys are ever exposed client-side
- [ ]  Confirm all Apify/OpenAI calls happen server-side (FastAPI) only
- [ ]  Test RLS thoroughly across all 4 tables with 2+ test users
- [ ]  Test idempotency: re-trigger a scrape for the same competitor, confirm no duplicate `scraped_content` rows
- [ ]  Test partial failure: simulate one competitor's Apify call failing — confirm others in the same project still complete and dashboard reflects the mixed state correctly
- [ ]  Basic loading/empty/error states throughout the frontend (projects list, competitor form, dashboard)
- [ ]  Sanity-check cost controls: confirm scrape is scoped to last 30 days / Reels only, and competitor cap (10) is enforced both client- and server-side

---

## Open Questions to Resolve Before/During Build

(See `prd.md` Section 8 for full context)

- [ ]  #5 — Final visual design of summary cards (left to design/Cursor discretion, but note it)

---

## Explicitly NOT in this TODO (v2 scope — do not build now)

- Full Notion-style chat interface
- Actual content generation (posts/captions/scripts)
- Twitter/Reddit scraping
- Fortune 500 growth strategy integration into generation
- Embeddings/vector search over summaries
- Multi-user/team projects
- Billing/subscriptions