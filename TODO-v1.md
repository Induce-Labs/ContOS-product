# ContOS — LinkedIn Scraping TODO (v1 extension)

> Companion checklist for adding LinkedIn competitor research alongside Instagram.
> Core Instagram product remains in [`TODO.md`](TODO.md). Build in order (L0 → L4).
>
> **Actor:** [`datadoping/linkedin-profile-posts-scraper`](https://apify.com/datadoping/linkedin-profile-posts-scraper)  
> **Pipeline:** scrape → analyze (no transcription; posts are text)  
> **Storage:** dedicated LinkedIn tables — never mix into Instagram `scraped_content` / `content_summaries`
>
> **Local-first:** run Frontend + Backend locally against your Supabase project + Apify token. Production deploy after LinkedIn works end-to-end locally.

---

## Product decisions (locked)

- Same projects as today; each competitor row has `platform` = `instagram` | `linkedin` (extend CHECK; keep twitter/reddit unused)
- Cap of **10 competitors per project** still applies across platforms
- Scraped posts → `linkedin_scraped_content` (not `scraped_content`)
- LLM summaries → `linkedin_content_summaries` (not `content_summaries`) — same JSON *shape* as Instagram for UI reuse, separate storage/fetch so IG and LI never overwrite or mix
- Apify input shape: `{ "profiles": ["username-or-url"], "max_posts": N }` (actor min 10 posts)

```
Frontend (LinkedIn URL)
  → POST /projects/{id}/competitors/scrape
  → platform == linkedin
  → scrape (Apify) → linkedin_scraped_content
  → LLM summarize → linkedin_content_summaries
  → Dashboard (LinkedIn section / badge)
```

---

## Phase L0 — Prerequisites / config

- [x]  Add backend env `APIFY_LINKEDIN_ACTOR_ID=datadoping/linkedin-profile-posts-scraper`
- [x]  Add backend env `LINKEDIN_MAX_POSTS` (default **50**; actor minimum **10**)
- [x]  Update `Backend/.env.example` and `Backend/app/config.py`
- [x]  Document actor cost/limits in env docs:
    - Paid per post (~$1.20 / 1,000 posts on Apify Store; confirm current pricing)
    - Free Apify tier actor limits: **4 profiles** per run, **max 100 posts** per profile
- [x]  Confirm existing `APIFY_API_TOKEN` is used (no new third-party secret required for this actor — “No Cookie”)

---

## Phase L1 — Database

- [x]  Migration: extend `competitors.platform` CHECK to include `'linkedin'`
    - Keep existing: `instagram`, `twitter`, `reddit`
- [x]  Create table `linkedin_scraped_content`:
    - [x]  `id` uuid PK
    - [x]  `competitor_id` uuid NOT NULL FK → `competitors` ON DELETE CASCADE
    - [x]  `external_id` text NOT NULL
    - [x]  `post_url` text
    - [x]  `posted_at` timestamptz
    - [x]  `caption` / post text
    - [x]  `likes` (or total reactions)
    - [x]  `comments_count`
    - [x]  `shares` / reposts
    - [x]  `author_name`, `author_headline` (optional, useful for LLM)
    - [x]  `raw_payload` jsonb
    - [x]  `scraped_at` timestamptz NOT NULL DEFAULT now()
    - [x]  `UNIQUE (competitor_id, external_id)` for idempotent re-scrapes
    - [x]  Index on `competitor_id`, `posted_at`
- [x]  Create table `linkedin_content_summaries` (mirror of `content_summaries`, LinkedIn-only):
    - [x]  `id`, `competitor_id`, `project_id`, `summary` jsonb, `model_used`, `generated_at`, nullable `embedding`
    - [x]  Trigger: `project_id` must match competitor’s project
    - [x]  Trigger/check: competitor must have `platform = 'linkedin'`
    - [x]  Do **not** insert LinkedIn LLM output into `content_summaries`
- [x]  RLS on both new tables: user can only access rows whose project is owned by `auth.uid()` (same pattern as Instagram tables)
- [ ]  **Apply migration to Supabase** — file ready at `supabase/migrations/20260804120000_linkedin_scraping.sql` (MCP timed out; paste into Supabase SQL Editor once)
- [x]  Update frontend `CompetitorPlatform` type and generated `database.ts` types

---

## Phase L2 — Backend pipeline

- [x]  `ApifyClient.scrape_linkedin_profile(profile_url)`:
    - [x]  Actor id from settings
    - [x]  Input: `profiles: [profile_url_or_slug]`, `max_posts: LINKEDIN_MAX_POSTS`
    - [x]  Sync run + dataset items (same pattern as Instagram scrape)
- [x]  Add `Backend/app/services/linkedin_parser.py`:
    - [x]  Map Apify items → `linkedin_scraped_content` rows
    - [x]  Map reactions → likes, comments, reposts/shares
    - [x]  Stable `external_id` from post id/url
- [x]  Branch in `Backend/app/services/pipeline.py`:
    - [x]  If `platform == 'linkedin'`: scrape → analyze only (**skip transcribing**)
    - [x]  Pipeline steps for LinkedIn: `queued` → `scraping` → `analyzing` → `done` | `failed`
    - [x]  If `platform == 'instagram'`: existing 3-step flow unchanged
- [x]  LLM path:
    - [x]  Load rows via `get_linkedin_content_for_summary`
    - [x]  Reuse `llm_client` + engagement enrichment; prompt labeled as **LinkedIn**
    - [x]  `replace_linkedin_content_summary` writes only to `linkedin_content_summaries`
- [x]  Supabase repo methods: upsert LinkedIn rows, get-for-summary, replace LinkedIn summary
- [x]  Add `Docs/phase-linkedin.md` (purpose, schema, env, pipeline, limits)
- [x]  Update `Backend/README.md` env table for LinkedIn vars

---

## Phase L3 — Frontend intake + dashboard

- [x]  LinkedIn URL/handle validation (`linkedin.com/in/...` or public slug)
    - [x]  Reject company pages (`/company/...`)
    - [x]  Normalize to a canonical profile URL
- [x]  New Project + Add Competitor:
    - [x]  Platform selector **or** separate LinkedIn field (Instagram remains default)
    - [x]  Create competitor with `platform = 'linkedin'` when LinkedIn input is used
- [x]  Sidebar competitor list: show platform hint (IG vs LI)
- [x]  Progress card for LinkedIn: **Queued → Scraping → Analyzing → Done** (no Transcribing step)
- [x]  Summaries fetch:
    - [x]  Instagram: `content_summaries`
    - [x]  LinkedIn: `linkedin_content_summaries`
- [x]  Dashboard: LinkedIn summary cards **separate** from Instagram (platform badge and/or grouped sections) so reports never look merged
- [x]  Display helper for LinkedIn profile URLs/handles

---

## Phase L4 — Hardening

- [x]  Scrape enqueue auth + project ownership covers LinkedIn competitors
- [x]  Idempotent re-scrape (no duplicate `linkedin_scraped_content` rows)
- [x]  Partial failure: one LinkedIn competitor failing does not kill Instagram (or other) competitors in the batch
- [x]  Empty Apify result → clear competitor `failed` + `error_message`
- [x]  Tests:
    - [x]  LinkedIn parser field mapping
    - [x]  Pipeline platform branch (skip transcription)
    - [x]  Summary write targets `linkedin_content_summaries` only
- [x]  Security review:
    - [x]  No Apify/service-role keys client-side
    - [x]  Only public LinkedIn profiles
    - [x]  RLS verified for both new tables (policies in migration; apply before use)

---

## Explicit non-goals (this checklist)

- LinkedIn cookie / `sessionid` (actor is “No Cookie”)
- Company page scraping
- Merging Instagram + LinkedIn into a single competitor row
- Twitter / Reddit scraping
- Changing Instagram transcription or `scraped_content` schema beyond allowing `linkedin` on `competitors.platform`

---

## Completion checklist (per phase)

Before marking a phase done:

- Functionality implemented
- Error handling exists
- Docs updated (`Docs/phase-linkedin.md` for L2+)
- Security reviewed
- No unnecessary complexity

### Local verify (after migration apply)

1. Paste/run `supabase/migrations/20260804120000_linkedin_scraping.sql` in Supabase SQL Editor
2. `cd Backend && uvicorn app.main:app --reload --port 8000`
3. `cd Frontend && npm run dev`
4. New project → add a LinkedIn `/in/` profile → confirm scrape → analyze → dashboard report
