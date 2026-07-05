# ContOS — Product Requirements Document (v1)

## 1. Overview

**Product Name:** ContOS

**One-liner:** ContOS is a specialized, context-aware AI command center that acts as a fractional Chief Marketing Officer (CMO) for entrepreneurs — generating high-ROI, platform-specific content by combining the user's brand persona with real-time scraped market/competitor trends in the analytics section, which is more of a memory and proprietary growth strategy frameworks which will be trained in the agentic path.

Just for the context, there will be three sections:

1. The profiling section
2. The analytics section, which is more of a memory section where it will be scraping the data and integrating a few of the APIs, which would help them scrape through multiple social media platforms
3. The agent section, wherein it is trained based on the Fortune 500 companies and will be doing context engineering in that part

**What makes it different from a generic LLM wrapper which is sort of an alpha factor and a differentiating factor for ContOS:**

- Grounded in real, scraped competitor/market performance data (not generic prompting)
- Persona-aware: content is generated in the user's distinct brand voice
- Strategy-aware: incorporates proprietary "Fortune 500" style growth playbooks
- Delivered through a dynamic, Notion-style interactive chat interface (not a plain chatbot)

**Scope of this document:** This PRD covers **Version 1** only — onboarding, project creation, competitor link intake, background scraping (Instagram only) via a Python/FastAPI backend, AI-generated performance summaries, and a basic dashboard (sidebar + main content layout) that shows live scraping progress and then displays the generated summaries. The full Notion-style interactive chat interface, actual content generation, and multi-platform scraping (Twitter, Reddit, etc.) are explicitly **out of scope** for v1 and will be covered in a v2 PRD.

---

## 2. Goals & Success Criteria (v1)

| Goal | Success Criteria |
| --- | --- |
| User can authenticate and create a project | User signs up/logs in via Supabase Auth, creates a project, selects a project type |
| System captures competitor context | User can submit competitor social links tied to a project |
| System autonomously gathers market data | Background job scrapes last 30 days of Reels for each competitor link via Apify |
| System distills raw data into insight | GPT-4o generates a structured performance summary per competitor/project |
| Data is stored for future use | Summary + raw scrape data persisted in Supabase in a structure ready for future embedding/MLOps pipelines |
| User sees progress and results without needing to wait or refresh manually | Dashboard shows a step-by-step progress card while scraping/summarization runs, then displays the generated summary once ready |

**Out of scope for v1:** full Notion-style chat interface, content generation, Twitter/Reddit scraping, personal-vs-business branching logic beyond capturing the selection, billing, team/multi-user projects.

---

## 3. User Flow (v1)

```
1. User lands on app → redirected to Supabase Auth (sign up / log in)
2. Post-authentication → Home/Projects screen
3. User clicks "New Project"
4. Modal/step: User types a **project name**, and selects "Is this project for Personal Branding or Business?"
     └── Name stored as project.name, selection stored as project.type
5. Form appears: "Add your competitors"
     - Input: Instagram profile link(s) (Twitter/X fields shown but disabled/"coming soon" in v1, OR simply hidden — see Open Question 1)
     - Minimum 1, recommended 5, maximum 10 competitors at this stage
     - Submit
6. On submit:
     a. Project + competitor records created in Supabase
     b. User is redirected **immediately** to the Dashboard
     c. Dashboard renders a **step-by-step progress card** (see Section 4.7) that reflects live pipeline status per competitor
     d. Async background job is triggered on the FastAPI backend (does NOT block the redirect):
          - Apify actor scrapes each competitor's Instagram
          - Raw scrape data stored in Supabase
          - GPT-4o summarization job runs on the scraped batch
          - Summary stored in Supabase, linked to competitor + project
7. As each step completes, the progress card updates (e.g., via polling or Supabase Realtime)
8. Once summarization completes for a competitor, its **summary is displayed on the dashboard** (see Section 4.7)
9. From the dashboard, the user can add more competitors later, up to the 10-competitor limit
```

**Key UX principle for v1:** The scrape + summarize pipeline must be fully asynchronous. The user should never be blocked waiting on Apify or OpenAI — they land on the dashboard immediately after submitting competitor links, and see live, step-by-step progress while processing happens in the background. Results (summaries) render on the same dashboard as soon as they're ready, competitor by competitor — no need to wait for the whole batch.

---

## 4. Functional Requirements

### 4.1 Authentication

- Use **Supabase Auth** for sign-up/login (email/password minimum for v1; social OAuth optional/stretch).
- On first login, if no projects exist for the user, show the "Create your first project" empty state.
- All data must be scoped to `auth.uid()` via Supabase Row Level Security (RLS) — no user should be able to read/write another user's projects, competitors, or scrape data.

### 4.2 Project Creation

- User creates a **Project**.
- Required field: `type` — enum `personal_branding` | `business`.
- Project has a name — user types this in during the creation flow (required field, e.g. shown right alongside or right after the personal/business type selection).
- On creation, project status should default to `onboarding` until scraping/summary completes, then move to `active` (or similar) — status values are informational for v1 since there's no UI consuming them yet, but should be modeled correctly for v2.

### 4.3 Competitor Intake Form

- After selecting project type, show a form to collect competitor social links.
- v1 supports **Instagram links only** for scraping, but the schema should be platform-agnostic (`platform` field) so Twitter/Reddit can be added in v2 without a schema migration.
- Support adding multiple competitors: **minimum 1, recommended 5, hard maximum 10** per project.
    - Show the "recommended 5" as guidance text in the UI, but allow the user to submit with anywhere from 1–10.
    - If the user adds fewer than 10 at project creation, they can return to the dashboard later and add more, up to the 10 total cap (enforced both client-side and server-side).
- Basic validation: must be a valid Instagram profile URL or handle.
- On submit, create `competitor` records linked to the `project`.

### 4.4 Background Scraping (Apify via FastAPI)

- Trigger: on competitor form submission (initial batch), or when a user adds new competitors later from the dashboard — either path calls the **Python/FastAPI backend**, which kicks off the scrape job asynchronously (see Section 6).
- Scraper: **Apify actors**, invoked from the FastAPI service:
    - **Instagram post scraper — apify**: gets all posts + reels for an account; we filter by date (last 30 days) and extract caption, likes, comments count (and other metrics where available).
    - **tictechid/anoxvanzi-Transcriber**: used to generate reel transcripts.
- Data to collect **per competitor**, filtered to **Reels only, posted within the last 30 days**:
    - Reel URL / ID
    - Post date
    - Likes
    - Views
    - Shares
    - Comments count (capture even if not explicitly listed — useful for future engagement scoring)
    - Caption text
    - Transcript of the reel (audio-to-text — confirm whether the chosen Apify actor provides this natively or whether a separate transcription step, e.g., Whisper, is needed — see Open Question 3)
- Store raw scrape payloads in Supabase (see schema in Section 5) — do not discard raw data after summarization, since it will feed future embeddings/MLOps work.
- Handle scrape failures gracefully: mark competitor's scrape status as `failed` with an error message field, don't crash the pipeline for other competitors in the same project.

### 4.5 AI Summarization (GPT-4o)

- Trigger: after a competitor's scrape completes successfully.
- **Dev/testing (v1):** use **OpenRouter (free)** to run the summarization step during development.
- **Production:** switch to **OpenAI GPT-4o** for summarization.
- Input to the LLM: the batch of scraped reels (caption, transcript, engagement metrics) for that competitor.
- Output: a **structured summary** covering:
    - Top-performing content (ranked, with why it performed well)
    - Recurring hooks/patterns used
    - Content strategies/themes identified
    - Aggregated engagement metrics (avg likes/views/shares, engagement rate if computable)
    - Any other strategic signal useful for a "fractional CMO" to act on
- Output must be returned/stored as **structured JSON** (not free text) so it can be reliably rendered on the v1 dashboard and later converted to embeddings.
- Store the summary in Supabase, linked to the competitor and project.
- As soon as a competitor's summary is stored, it should become visible on the dashboard (see Section 4.7) — the user does not need to wait for other competitors in the batch to finish.

### 4.7 Dashboard (v1)

- **Layout:** Sidebar (left) + main content area (right).
    - **Sidebar:** lists the user's projects (and, once a project is selected, its competitors); includes a persistent "Add Competitor" action (disabled/tooltip once the 10-competitor cap is reached).
    - **Main content area:** shows the selected project's state — progress card while processing, summaries once ready.
- **Progress card (step-by-step):** For each competitor being processed, show a simple step tracker, e.g.:
    1. Queued
    2. Scraping Instagram (Apify)
    3. Analyzing content (GPT-4o)
    4. Done
    - Each competitor gets its own row/card with its current step highlighted; failed steps show an inline error state (using `competitors.error_message`).
    - Card should update live as status changes — via polling (simplest for v1) or Supabase Realtime subscriptions on the `competitors`/`content_summaries` tables (preferred if time allows).
- **Summary display:** Once a competitor's `content_summaries` row exists, render it on the dashboard in the main content area — e.g., as a card or section per competitor showing top-performing content, hooks, strategies, and aggregated engagement metrics. Exact visual design is flexible for v1; the structured JSON fields from Section 4.5 should all be represented somewhere in the UI.
- **Add more competitors:** A visible action in the sidebar or main content area lets the user add additional competitors to the current project at any time, up to the 10-competitor cap. Submitting triggers the same FastAPI scrape → summarize pipeline for just the newly added competitor(s), and the new competitor appears in the progress card immediately.

### 4.6 Data Persistence Strategy

- Use a hybrid relational + JSONB approach in Supabase (Postgres):
    - Strongly-typed relational columns for fields we will query/filter/aggregate on (dates, metrics, status enums, foreign keys).
    - JSONB columns for the raw scrape payload and the LLM-structured summary, since their shape may evolve and will later be chunked/embedded.
- This structure should be designed so that, in the future, each JSONB summary (or sections of it) can be turned into embeddings and stored in a vector column (e.g., via `pgvector`) without re-architecting the schema.

---

## 5. Data Model (Supabase / Postgres)

> Note for Cursor: this is a **starting schema**, not final DDL. Adjust types/constraints as needed but preserve the entities, relationships, and RLS approach described here.
> 

### `projects`

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid, PK | default `gen_random_uuid()` |
| user_id | uuid, FK → auth.users | RLS scoped |
| name | text | required, user-entered at project creation |
| type | text (enum: `personal_branding`, `business`) | required |
| status | text (enum: `onboarding`, `scraping`, `ready`, `failed`) | default `onboarding` |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### `competitors`

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid, PK |  |
| project_id | uuid, FK → projects |  |
| platform | text (enum: `instagram`, `twitter`, `reddit`, ...) | v1 only populates `instagram` |
| handle_or_url | text | as submitted by user |
| scrape_status | text (enum: `pending`, `in_progress`, `completed`, `failed`) | default `pending` — overall status |
| pipeline_step | text (enum: `queued`, `scraping`, `analyzing`, `done`, `failed`) | default `queued` — drives the dashboard progress card (Section 4.7) |
| last_scraped_at | timestamptz | nullable |
| error_message | text | nullable, populated on failure |
| created_at | timestamptz |  |

### `scraped_content`

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid, PK |  |
| competitor_id | uuid, FK → competitors |  |
| platform | text | denormalized for query convenience |
| content_type | text | `reel` for v1 |
| external_id | text | platform's post/reel ID |
| posted_at | timestamptz | used for the 30-day filter |
| likes | integer | nullable |
| views | integer | nullable |
| shares | integer | nullable |
| comments_count | integer | nullable |
| caption | text | nullable |
| transcript | text | nullable |
| raw_payload | jsonb | full raw Apify record, for future reprocessing |
| scraped_at | timestamptz | default now() |

### `content_summaries`

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid, PK |  |
| competitor_id | uuid, FK → competitors |  |
| project_id | uuid, FK → projects | denormalized for easier querying |
| summary | jsonb | structured LLM output (top content, hooks, strategies, metrics) |
| model_used | text | e.g. `gpt-4o` |
| generated_at | timestamptz | default now() |
| embedding | vector | nullable in v1, reserved for future MLOps use (requires `pgvector` extension enabled but not necessarily populated yet) |

**RLS:** All tables scoped so a user can only access rows where the row's `project_id` (directly or via `competitor_id`) belongs to a project owned by `auth.uid()`.

---

## 6. Technical Architecture (v1)

- **Frontend:** **ReactJS + Tailwind CSS** — v1 needs: Auth screens, "New Project" flow (name input → type selection → competitor form), and the **Dashboard** (sidebar + main content layout) with the progress card and summary display described in Section 4.7.
- **Auth & DB:** Supabase (Postgres + Auth + RLS).
- **Backend (scraping/orchestration):** **Python + FastAPI** service, separate from the frontend. Responsibilities:
    - Exposes an endpoint the frontend calls on competitor form submission (initial or "add more") to enqueue scrape jobs
    - Orchestrates the Apify → GPT-4o pipeline per competitor
    - Writes results directly to Supabase (using a service-role key, server-side only — never exposed to the frontend)
    - Updates `competitors.scrape_status` (and step-level status, if modeled — see Open Question 6) as the pipeline progresses, so the dashboard's progress card has something to read/subscribe to
- **Scraping:** Apify actors for Instagram (Reels, filtered to last 30 days by post date), invoked from the FastAPI backend.
- **Background jobs:** Scraping and summarization must run **asynchronously**, decoupled from the user-facing request/response cycle. Recommended approach: FastAPI background tasks, or a lightweight task queue (e.g., Celery, RQ, or an async job runner) invoked by FastAPI, which:
    1. Calls the Apify actor(s) for each competitor
    2. Writes results to `scraped_content`
    3. Calls OpenAI GPT-4o with the scraped batch
    4. Writes the structured result to `content_summaries`
    5. Updates `competitors.scrape_status` and `projects.status` accordingly at each step, so the frontend progress card can reflect it
- **Frontend ↔ Backend communication for progress:** either the frontend polls Supabase directly for `competitors.scrape_status` changes (simplest for v1, works well since Supabase is already the source of truth), or subscribes via Supabase Realtime. The FastAPI service does not need to push directly to the frontend — it just needs to keep Supabase up to date as it works.
- **LLM (summarization):**
    - **Dev/testing:** OpenRouter (free) via API (FastAPI backend), prompted to return strict structured JSON (use a defined JSON schema/response format to reduce parsing errors).
    - **Production:** OpenAI GPT-4o via API (FastAPI backend), using the same structured JSON response format.
- **Error handling:** Each competitor's pipeline should fail independently — one competitor's scrape/summarization failure should not block others in the same project, and should be reflected as a distinct failed state in that competitor's progress card row.

---

## 7. Non-Functional Requirements

- **Security:** RLS enforced on every table; no service-role key exposed client-side; Apify/OpenAI API calls happen server-side only.
- **Reliability:** Background jobs should be retryable/idempotent where possible (e.g., re-running a failed scrape shouldn't duplicate `scraped_content` rows — use `external_id` uniqueness per competitor).
- **Extensibility:** Schema must support adding new platforms (Twitter, Reddit) and new content types without breaking changes.
- **Cost control:** Limit scrape volume to last 30 days / Reels only as specified; consider a soft cap on number of competitors per project in v1.
- **Auditability:** Keep raw scrape payloads (`raw_payload` JSONB) even after summarization, for reprocessing and future embedding generation.

---

## 8. Open Questions (for team/Cursor to resolve before or during build)

1. Should Twitter/Reddit fields be visible-but-disabled in the v1 competitor form (to signal roadmap) or fully hidden until v2?
2. Transcripts: we will use **tictechid/anoxvanzi-Transcriber** (no Whisper step in v1).
3. Polling vs. Supabase Realtime for the dashboard progress card — Realtime is a better UX (instant updates) but adds implementation complexity; polling is simpler to ship first. Which should v1 start with?
4. Should the FastAPI service run as a persistent server (with an in-process/Celery-style task queue) or as a serverless/on-demand deployment? This affects how background jobs are hosted and scaled.
5. Exact visual design for the summary cards on the dashboard (Section 4.7) — layout, ordering, and whether raw metrics are shown alongside the AI-generated narrative — is left to design/Cursor discretion for v1 as long as all structured summary fields are represented.

---

## 9. Explicitly Out of Scope for v1 (deferred to v2)

- Full interactive Notion-style **chat** interface (v1 dashboard is sidebar + main content with progress card and summary display only — not chat-based)
- Actual content generation (posts, captions, scripts, etc.)
- Twitter, insta, and other platform scraping
- Proprietary Fortune 500 growth strategy integration into generation logic
- Embeddings generation/vector search over summaries
- Team/multi-user project collaboration
- Billing/subscription logic
- Polished, final visual design of the dashboard (functional v1 layout only — see Open Question 5)

---

## 10. Acceptance Criteria (Definition of Done for v1)

- [ ]  User can sign up / log in via Supabase Auth
- [ ]  User can create a project by typing a project name and selecting `personal_branding` or `business`
- [ ]  User can submit 1–10 Instagram , X , Linkedin competitor links tied to the project (min 1, recommended 5 shown as guidance, hard cap 10)
- [ ]  User is redirected to the Dashboard **immediately** after submission (non-blocking)
- [ ]  Dashboard renders with a **sidebar** (projects/competitors) and **main content area** (progress card / summaries)
- [ ]  Dashboard shows a **step-by-step progress card** per competitor (Queued → Scraping → Analyzing → Done / Failed) that updates as the pipeline runs
- [ ]  Python/FastAPI backend orchestrates the scrape → summarize pipeline (not run directly from the frontend)
- [ ]  Background job scrapes the last 30 days of Reels for each competitor via Apify, capturing likes, views, shares, caption, and transcript
- [ ]  Raw scrape data is persisted in Supabase per competitor
- [ ]  GPT-4o generates a structured JSON summary (top content, hooks, strategies, metrics) per competitor
- [ ]  Summary is persisted in Supabase, linked to the correct project/competitor
- [ ]  As soon as a competitor's summary is ready, it is **displayed on the dashboard** without requiring other competitors to finish
- [ ]  User can return to the dashboard later and add more competitors, up to the 10-competitor cap, triggering the same pipeline for just the new additions
- [ ]  RLS confirms one user cannot access another user's project/competitor/scrape/summary data
- [ ]  A failed scrape or summarization for one competitor does not block or crash others in the same project, and is reflected as a failed state in its progress card row