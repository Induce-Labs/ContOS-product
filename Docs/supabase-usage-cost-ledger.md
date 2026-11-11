# Supabase usage & cost ledger

## Purpose

Track ContOS spend drivers (LLM tokens, Apify scrape items, Supermemory ops) with **estimated USD** so you can see cost per user/operation in the Table Editor. This is metering for admin visibility and a future entitlements layer — not checkout or plan enforcement.

## Tables

| Table | Role |
| --- | --- |
| `usage_price_rates` | Editable unit-price card (`token_in` / `token_out` / `token_embed` / `scrape_item` / `sm_op`) |
| `usage_events` | Append-only ledger; `user_email` is column #1 |
| `usage_daily_by_user` | Service-role aggregate view (day × user × operation) |

Migration: `supabase/migrations/20261110200000_usage_cost_ledger.sql`

RPC: `contos_log_usage_event(...)` looks up rates, resolves `user_email`, inserts one row.

## Operations logged

| `operation` | Provider | Quantity fields |
| --- | --- | --- |
| `supermemory_op` | supermemory | `sm_ops` |
| `website_scrape` | apify | `scrape_items` |
| `website_summary_llm` | openrouter | `input_tokens` / `output_tokens` |
| `competitor_scrape_instagram` / `_linkedin` / `_twitter` | apify | `scrape_items` |
| `competitor_transcribe_instagram` | apify | `scrape_items` |
| `competitor_summary_llm` | openrouter | tokens |
| `summary_embedding` | openrouter | `embed_tokens` |
| `agent_chatbot` / `agent_linkedin` / `agent_instagram` / `agent_twitter` / `agent_playbook` | openrouter | tokens |
| `draft_judge_llm` | openrouter | tokens |
| `rag_embedding` | openrouter | `embed_tokens` |
| `translation_llm` | openrouter | tokens |
| `supermemory_llm` | openrouter | `input_tokens` / `output_tokens` (SM-only OpenRouter key, daily ingest) |
| `supermemory_embed` | openrouter | `embed_tokens` (SM remote embeddings via OpenRouter) |

Supermemory infra tokens are **not** logged per request. A daily job pulls OpenRouter `/activity` for the SM-only key (Management API) and writes one row per `(date, model, kind)` with idempotent `source_ref` like `sm-or:2026-11-10:openai_text-embedding-3-small:embed`. Metadata includes `openrouter_usage_usd` (provider-reported) and `scope=supermemory_infra`.

Env (Agents web + worker + beat):

| Variable | Role |
| --- | --- |
| `OPENROUTER_MANAGEMENT_KEY` | Management/provisioning key for `/keys` + `/activity` |
| `SUPERMEMORY_OPENROUTER_API_KEY_HASH` | Hash of the SM inference key (preferred) |
| `SUPERMEMORY_OPENROUTER_KEY_NAME` | Fallback label match (default `supermemory`) |

Manual trigger: `POST /api/admin/usage/supermemory-openrouter/ingest` (admin). Celery: `usage.ingest_supermemory_openrouter` (Beat daily ~02:15 UTC). Requires a Railway **beat** process from `Procfile`.

## How to use

1. Open Supabase → **Table Editor** → `usage_events` (or `usage_price_rates`).
2. Filter by `user_email` / `operation` / `created_at`.
3. To change pricing, insert a new row in `usage_price_rates` with a later `effective_from` (or edit the active row). No code deploy required for rate tweaks.

## Writers

- Agents: `Agents/backend/db/usage_ledger.py` (base agent, judge, website, embed, translate, supermemory ops)
- Agents: `Agents/backend/services/supermemory_usage_ingest.py` + `tasks/usage_metering.py` (SM OpenRouter LLM/embed activity)
- Backend: `Backend/app/services/usage_ledger.py` (competitor pipeline scrape / transcribe / summary / Twitter embedding)

Logging is **best-effort** — failures are logged and never break product flows.

## Security

- RLS enabled; **service_role only** (no anon/authenticated access).
- Clients cannot set `estimated_cost_usd`; the RPC computes it from the rate card.
- `user_email` is PII; treat like other ContOS user-owned tables.

## Known limitations

- Estimates only — OpenRouter provider routing and Apify actor billing can differ from seeded rates.
- Self-hosted Supermemory API ops remain `supermemory_op` at **$0**; LLM/embed spend is metered separately via OpenRouter activity (`supermemory_llm` / `supermemory_embed`).
- OpenRouter `/activity` is day-grain and can lag; same-day live metering is not available.
- `estimated_cost_usd` uses ContOS `usage_price_rates`; provider-reported USD is also stored in metadata as `openrouter_usage_usd`.
- Historical `agent_calls` are not backfilled into `usage_events`.
- Draft-judge / nested LLM calls are separate rows from the main agent invoke.
- No Dodo / plan quota enforcement in this change.

## Future improvements

- Backfill from `agent_calls`
- Monthly rollup table for billing entitlements
- Capture OpenRouter cache-hit token tiers separately
