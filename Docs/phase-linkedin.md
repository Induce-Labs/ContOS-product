# Phase LinkedIn — Profile post scrape → analyze

## Purpose

Add LinkedIn competitor research beside Instagram without mixing storage. Same projects and competitor cap; each row has `platform = 'linkedin'`. Pipeline is **scrape → analyze** (no transcription).

## High-level flow

```
Frontend (LinkedIn profile URL)
  → POST /projects/{id}/competitors/scrape
  → platform == linkedin
  → Apify datadoping/linkedin-profile-posts-scraper
  → linkedin_scraped_content
  → LLM summarize (LinkedIn-labeled prompt)
  → linkedin_content_summaries
  → Dashboard (LinkedIn badge / progress without Transcribing)
```

## Architecture decisions

- **Separate tables** (`linkedin_scraped_content`, `linkedin_content_summaries`) so Instagram and LinkedIn never overwrite or join incorrectly.
- **Same summary JSON shape** as Instagram for UI reuse; frontend tags `source: 'linkedin' | 'instagram'`.
- **No cookie / sessionid** — actor is “No Cookie”; only public profiles.
- **Company pages rejected** in frontend validation (`/company/...`).
- Local-first: point backend at your existing Supabase + Apify token; production cutover later.

## Schema

Migration: `supabase/migrations/20260804120000_linkedin_scraping.sql`

- Extends `competitors.platform` CHECK with `'linkedin'`.
- `linkedin_scraped_content`: posts with metrics, author fields, `UNIQUE (competitor_id, external_id)`.
- `linkedin_content_summaries`: mirror of Instagram summaries; trigger requires competitor `platform = 'linkedin'` and matching `project_id`.
- RLS: access only via projects owned by `auth.uid()`.

## API

No new endpoints. Existing scrape enqueue branches on competitor platform:

```
POST /projects/{project_id}/competitors/scrape
Authorization: Bearer <supabase_access_token>
Body: { "competitor_ids": ["uuid", ...] }
→ 202 Accepted
```

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `APIFY_API_TOKEN` | (required) | Shared with Instagram scrapers |
| `APIFY_LINKEDIN_ACTOR_ID` | `datadoping/linkedin-profile-posts-scraper` | |
| `LINKEDIN_MAX_POSTS` | `50` | Actor minimum **10**; free tier often caps **100** posts / profile and **4** profiles per run |

Approximate Apify Store pricing for this actor is on the order of **~$1.20 / 1,000 posts** (confirm on the [actor page](https://apify.com/datadoping/linkedin-profile-posts-scraper)).

## Pipeline steps (LinkedIn)

1. `queued` → `scraping` — Apify profile posts → upsert `linkedin_scraped_content`
2. `analyzing` — load LinkedIn rows, LLM summarize, write `linkedin_content_summaries`
3. `done` or `failed` with `error_message`

Instagram still uses scrape → transcribe → analyze unchanged.

## Frontend

- Platform selector on New Project and Add Competitor.
- Validation/normalize in `Frontend/src/lib/linkedin.ts`.
- Progress: four steps (no Transcribing).
- Summaries: `fetchAllSummariesForProject` merges both tables.

## Local development

Point the frontend at your local FastAPI server (not Railway) while developing LinkedIn:

```
# Frontend/.env.local
VITE_API_BASE_URL=http://localhost:8000
```

Restart `npm run dev` after changing this. Railway production will not have LinkedIn routing until that backend is redeployed.

## Known limitations

- Personal `/in/` profiles only (no company pages).
- Free Apify tier profile/post caps may truncate research.
- Analyze sends the **top 20 posts by engagement** with captions truncated (~600 chars) to the LLM so `openrouter/free` does not stall on 50 long posts. Aggregated metrics still use the full scrape.

## Future improvements

- Company-page support if a suitable actor is chosen.
- Grouped dashboard sections by platform when many competitors.
- Optional lookback window if the actor adds date filters.
