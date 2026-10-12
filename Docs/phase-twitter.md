# Phase Twitter/X — Profile tweet scrape → analyze

## Purpose

Add X/Twitter competitor research beside Instagram and LinkedIn without mixing storage. Same avatars and competitor cap; each row has `platform = 'twitter'`. Pipeline is **scrape → analyze** (no transcription). Tweets are limited to the **last 7 days**.

## High-level flow

```
Frontend (X/Twitter handle or profile URL)
  → POST /avatars/{id}/competitors/scrape
  → platform == twitter
  → Apify xquik/x-tweet-scraper
  → twitter_scraped_content
  → LLM summarize (Twitter-labeled prompt)
  → twitter_content_summaries
  → Dashboard (Twitter badge / progress without Transcribing)
```

## Architecture decisions

- **Separate tables** (`twitter_scraped_content`, `twitter_content_summaries`) so Instagram/LinkedIn/Twitter never overwrite or join incorrectly.
- **No engagement metric columns** on scraped rows (likes/replies/retweets/views are not persisted). Author/profile fields are stored; raw Apify payload remains in `raw_payload`.
- **Same summary JSON shape** as Instagram/LinkedIn for UI reuse; frontend tags `source: 'twitter' | 'linkedin' | 'instagram'`.
- Reuses existing `APIFY_API_TOKEN` (Bearer header). Never put tokens in URLs or source.

## Schema

Migration: `supabase/migrations/20260918120000_twitter_scraping.sql`

- `twitter_scraped_content`: tweet text, URLs, timestamps, author fields, `UNIQUE (competitor_id, external_id)`.
- `twitter_content_summaries`: mirror of LinkedIn summaries; trigger requires competitor `platform = 'twitter'` and matching `avatar_id`.
- RLS: access only via avatars owned by `auth.uid()`.
- RPC: `match_twitter_content_summaries` for agent RAG.

## API

No new endpoints. Existing scrape enqueue branches on competitor platform:

```
POST /avatars/{avatar_id}/competitors/scrape
Authorization: Bearer <supabase_access_token>
Body: { "competitor_ids": ["uuid", ...] }
→ 202 Accepted
```

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `APIFY_API_TOKEN` | (required) | Shared with Instagram/LinkedIn scrapers |
| `APIFY_TWITTER_ACTOR_ID` | `xquik/x-tweet-scraper` | |
| `TWITTER_MAX_ITEMS` | `50` | Cap per profile run |
| `SCRAPE_LOOKBACK_DAYS` | `7` | Passed as Apify `within_time: Nd` and enforced again in the parser |

## Pipeline steps (Twitter)

1. `queued` → `scraping` — Apify profile tweets (7d) → upsert `twitter_scraped_content`
2. `analyzing` — load Twitter rows, LLM summarize, write `twitter_content_summaries`
3. `done` or `failed` with `error_message`

Instagram and LinkedIn pipelines are unchanged.

## Frontend

- Platform selector on New Project and Add Competitor includes X/Twitter.
- Validation/normalize in `Frontend/src/lib/twitter.ts`.
- Progress: four steps (no Transcribing).
- Summaries: `fetchAllSummariesForAvatar` merges Instagram, LinkedIn, and Twitter tables.

## Agents

- `fetch_summaries` / similarity search read `twitter_content_summaries` when platform is `twitter` or `x`.
- Twitter content agent RAG uses the new table.

## Known limitations

- Engagement metrics are not stored or enriched for Twitter summaries.
- Free Apify tier item caps may truncate research.
- Analyze sends a capped set of recent tweets (see `LLM_MAX_CONTENT_ITEMS`) with captions truncated for the LLM.
- After analyze, Backend writes a pgvector `embedding` on `twitter_content_summaries` (OpenRouter). If that fails, run `POST /api/embeddings/backfill-twitter-summaries` on the Agents API.

## Agents / chatbot context

- Chatbot (`chatbot_context_on`) retrieves LinkedIn + Instagram + Twitter summaries via `fetch_summaries` / `similarity_search`.
- X agent (`agent_type=twitter`) RAG uses `twitter_content_summaries` + `match_twitter_content_summaries`.
- Embeddings: `vector(1536)` HNSW index; RPC `match_twitter_content_summaries`.

## Security

- Rotate any Apify token that was shared in a URL or chat.
- Keep tokens in env / secrets managers only.
