# ContOS Agents — Phase 2 Documentation

**Product:** ContOS — fractional CMO / Marketing-as-a-Service  
**Scope:** Agent section that turns brand profile + competitor intelligence + Fortune 500 playbooks into platform-native marketing outputs  
**Last updated:** August 2026

---

## 1. What we’re building

ContOS agents take:

1. **Brand profile** — business name, voice, audience, goals, industry  
2. **Competitor intelligence** — `content_summaries.summary` (JSONB) from Supabase  
3. **Fortune 500 playbooks** — rules stored in Supabase with `pgvector` embeddings  

…and produce:

- Strategy / guardrail audits (**Playbook**)
- Instagram calendars, LinkedIn posts, Twitter/X tweets (**platform agents**)
- Conversational CMO help (**Chatbot**, with context ON/OFF)

All data fetching goes through an **MCP tool layer**. Agents never query Supabase directly.

---

## 2. Repo layout

```
contos-agents/
├── backend/
│   ├── main.py                 # FastAPI + SSE endpoints
│   ├── agents/                 # BaseAgent + 5 specialized agents
│   ├── mcp/                    # MCP server + tools
│   ├── context/                # assemble + compress context
│   ├── embeddings/             # OpenRouter text-embedding-3-small
│   ├── prompts/                # system prompts per agent
│   ├── schemas/                # JSON output schemas
│   ├── db/                     # Supabase client helpers
│   ├── mock/                   # mock profile / summaries / playbooks
│   ├── .env                    # secrets (gitignored)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx             # thin shell → ChatWindow
│   │   └── components/
│   │       ├── ChatWindow.jsx      # main chatbot UI
│   │       ├── AgentSelector.jsx   # Chat / LinkedIn / Twitter / …
│   │       ├── ContextToggle.jsx   # brand context ON/OFF
│   │       ├── CompetitorTable.jsx # 10-row competitor links
│   │       └── OutputRenderer.jsx  # platform-specific rendering
│   ├── vite.config.js          # proxies /api → :8001
│   └── package.json
├── sql/
│   ├── 001_agent_tables.sql    # playbooks, profiles, agent_calls, RPC
│   └── 002_rls_policies.sql    # optional RLS for non-secret keys
├── docs/
│   └── AGENTS.md               # this document
└── README.md
```

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  React Chatbot UI  (http://127.0.0.1:5173)              │
│  • Platform chips (Chat, LinkedIn, Twitter, Reddit, …)  │
│  • Context toggle                                       │
│  • 10-row competitor links table                        │
│  • SSE streaming chat                                   │
└──────────────────────────┬──────────────────────────────┘
                           │ Vite proxy /api → :8001
                           ▼
┌─────────────────────────────────────────────────────────┐
│  FastAPI  POST /api/agents/invoke  (SSE)                │
│  get_agent(agent_type).run(...)                         │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│  BaseAgent / ChatbotAgent                               │
│  1. MCP gather tools (profile, summaries, playbooks)    │
│  2. assemble_context + compress (< ~6000 tokens)        │
│  3. system prompt for agent                             │
│  4. Kimi K2.6 via OpenRouter (stream)                   │
│  5. parse JSON (or plain text for chatbot)              │
│  6. log agent_calls (async)                             │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│  MCP tools                                              │
│  fetch_profile | fetch_summaries | similarity_search    │
│  scrape_competitor | fetch_playbooks                    │
│  → Supabase profiles/projects + content_summaries.summary + embeddings │
└─────────────────────────────────────────────────────────┘
```

### Key decisions

| Decision | Why |
|----------|-----|
| In-process MCP registry | Same tool interface as MCP, works with FastAPI SSE without a separate stdio process |
| Live Supabase only | Tools read `content_summaries.summary` and row `embedding` columns — no mock fallbacks |
| Playbook uses tool calling | LLM decides *when* to fetch rules — not every message |
| Chatbot context toggle | ON = brand + competitor context; OFF = general marketing chat |
| Embeddings via OpenRouter | `openai/text-embedding-3-small` with same `OPENROUTER_API_KEY` as the LLM |
| Chatbot UI as the shell | Platform options, toggle, and competitor table live *inside* the chatbot |

---

## 4. The agents

| UI chip | Backend `agent_type` | Output |
|---------|----------------------|--------|
| **Chat** | `chatbot` | Plain conversational text |
| **LinkedIn** | `linkedin` | Structured JSON (`post_ideas`, themes, mix, …) |
| **Twitter** | `twitter` | Structured JSON (`tweet_ideas`, threads, …) |
| **Reddit** | `chatbot` + Reddit focus hint | Conversational / Reddit-native guidance |
| **Instagram** | `instagram` | Structured JSON (`content_calendar`, hooks, …) |
| **Playbook** | `playbook` | Structured JSON (frameworks, guardrails, audit) |

### Output requirements

- Platform / playbook agents **must** include **reasoning** for each recommendation.
- **Video / Reel / Story** plans **must** include a full spoken **`transcript`** (timed beats).
- Chatbot returns **plain text only** (no JSON envelope).
- Greetings (`hi`, `hello`, …) use an **instant reply path** (no OpenRouter call).

### Chat routing (general Chat mode)

- **Broad ask** (e.g. “content for a month” with no platform): chatbot asks clarifying questions (platforms, cadence, formats) and shows quick actions: all platforms / LinkedIn / Instagram / Twitter.
- **Named platform** (e.g. “LinkedIn calendar”): UI auto-routes to that specialized agent (or Playbook).
- **“All platforms” / confirm after clarify**: runs LinkedIn → Instagram → Twitter agents in sequence.

## Competitor knowledge base

1. User pastes competitor links in the 10-row table.
2. Frontend calls `POST /api/competitors/ingest` which resolves URLs against Supabase `competitors` → `content_summaries.summary`.
3. Chat shows: *“Your knowledge base has been updated…”*
4. Later chat / agent calls send `competitor_summaries` so ContOS can answer about those competitors’ tactics, hooks, and themes.


---

## 5. MCP tools

| Tool | Input | Behavior |
|------|-------|----------|
| `fetch_profile` | `user_id`, `project_id?` | `profiles` → else `projects` (name/type) |
| `fetch_summaries` | `project_id`, `platform?` | `content_summaries.summary` + competitors |
| `similarity_search` | `query_text`, `table`, `top_k`, `project_id?`, `fast?` | Embed + playbook/`content_summaries` embeddings |
| `scrape_competitor` | `url`, `platform`, `project_id?` | Load existing summary from DB (Apify live scrape TODO) |
| `fetch_playbooks` | `category?` | `playbooks` table |

---

## 6. LLM & embeddings

| Concern | Value |
|---------|--------|
| Chat / content LLM | `moonshotai/kimi-k2.6` via OpenRouter |
| Embeddings | `openai/text-embedding-3-small` via OpenRouter (1536 dims) |
| Streaming | SSE `status` → `token`* → `complete` / `error` |
| Chatbot max tokens | `CHATBOT_MAX_TOKENS` (default: no limit; if a limit is set, replies that hit it are continued automatically) |
| Platform agent max tokens | `AGENT_MAX_TOKENS` (default: no limit; tokens are logged per call) |
| Context token budget | `AGENT_MAX_CONTEXT_TOKENS` (default 3500) |

---

## 7. Frontend (chatbot UI)

Everything lives inside one **ContOS chatbot** panel:

1. **Header** — brand + status  
2. **Platform chips** — Chat / LinkedIn / Twitter / Reddit / Instagram / Playbook  
3. **Context toggle** — brand context ON/OFF  
4. **Competitor table** — 10 rows (`#`, platform, URL/handle), show/hide  
5. **Message stream** — SSE tokens; `OutputRenderer` formats calendars / cards / chat bubbles  
6. **Composer** — text input + Send  

Vite proxies `/api` → `http://127.0.0.1:8001` so the browser avoids CORS.

Filled competitor links are appended to the prompt; first matching URL can set `live_mode` + `competitor_url`.

---

## 8. Database

### Already existed (do not recreate)

- `competitors`, `content_summaries`, `projects`, `scraped_content`

### Added (`sql/001_agent_tables.sql`)

- `agent_calls` — audit log (tokens, context snapshot, status)  
- `playbooks` — rules + `embedding vector(1536)` + HNSW index  
- `profiles` — brand profiles  
- Extension: `vector`  
- RPC: `match_playbooks(query_embedding, match_count, filter_category)`

### RLS (`sql/002_rls_policies.sql`)

Optional open policies for local/dev if not using the **secret / service_role** key.

**Use `sb_secret_…` (or legacy service_role JWT) in `SUPABASE_SERVICE_ROLE_KEY`.** Publishable keys hit RLS on inserts.

---

## 9. API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health + model / key flags |
| `POST` | `/api/agents/invoke` | Agent invoke (SSE) |
| `POST` | `/api/profiling/summarize` | Generate `avatars.website_summary` (optional URL via Apify WCC) then `avatars.profile_summary` from `profiling_data` (+ website context) |
| `POST` | `/api/embeddings/store-playbooks` | Embed + store mock playbooks |
| `GET` | `/api/mcp/tools` | List MCP tool schemas |

### Local flow console logs

When `LLM_ENV` is not `prod` (or `CONTOS_FLOW_LOGS=1`), the Agents process emits filterable lifecycle lines on logger `contos.flow` **and** forwards the same events to Chrome DevTools in local Vite (`import.meta.env.DEV`):

- `[CONTOS:PROFILING]` — summarize enqueue, Supabase Q&A load, website step, mark completed (no LLM summary)
- `[CONTOS:PROFILE_SYNC]` — Supermemory profile document GET/POST/PATCH/skip and Celery retries
- `[CONTOS:PROFILE_READ]` — profile retrieval lifecycle for LinkedIn / Instagram / X and chatbot-with-context (gate → SM GET → validation → **Source for this reply** with `destination=Supermemory|Supabase profiling_data|none` → injection → LLM handoff). Counts/status only; never profile text. Forwarded to Chrome via SSE `contos_flow` on `/api/agents/invoke` (same path as MEMORY_READ). Request buffer is thread-local so nested `agent.run()` generators still reach the browser.
- `[CONTOS:MEMORY_WRITE]` — validated strategist writes to Supermemory (no content logged)
- `[CONTOS:MEMORY_READ]` — hybrid retrieval, empty-success vs Supabase fallback

**How events reach Chrome**
- Agent invoke: SSE event `contos_flow` on `/api/agents/invoke` (request-scoped buffer drained during the stream).
- Celery profiling/sync: events are published to a short-lived Redis list keyed by user+avatar; the frontend drains them via authenticated `GET /api/dev/flow-events?avatar_id=…` while the existing profile-summary poll runs (no extra polling system). Endpoint returns 404 when flow logs are disabled.

Filter terminals or DevTools with `CONTOS:`. Browser DEV dual-emits `console.log` + `console.warn` so Custom levels still show them; each chat invoke also prints `[CONTOS:FLOW] invoke start/done` breadcrumbs and drains Redis via `GET /api/dev/flow-events`. Force off with `CONTOS_FLOW_LOGS=0`. Logs never include API keys, prompts, memory text, or profile bodies.

**Important distinctions**
- Profiling completion stores questionnaire answers in **Supabase** and syncs the full Q&A (+ optional `website_summary`) into Supermemory document `profile`. It does **not** generate an LLM `profile_summary`.
- LinkedIn / Instagram / X, and chatbot when brand context is on, load brand profile context via `[CONTOS:PROFILE_READ]` (`GET …/document/profile`) into `brand_profile.profile_context`. Historical `profile_summary` is cleared on that path. When usable `profile_context` is present, raw `profiling_data` is **omitted** from the LLM-facing `brand_profile` (a `profiling_answer_count` may remain). If the SM document already includes a `website_summary:` section, sibling `website_summary*` fields are also omitted. On SM failure/processing/empty, a **compact** deterministic bullet fallback is used — never the old LLM summary and never the full 26-answer dump beside raw `profiling_data`. `assemble_context` also strips raw `profiling_data` from **every** `avatar_profiles` entry (including non-primary multi-avatar rows) without copying the primary’s `profile_context` or issuing extra Supermemory GETs — flattened fields / per-avatar `website_summary` remain. Chatbot with context off and Playbook do not use this path. Draft-judge skips `profiling_answers` when `profile_context` is present. LLM handoff logs `brand_profile_tokens` / `context_tokens` estimates (counts only).
- `[CONTOS:MEMORY_READ]` / `[CONTOS:MEMORY_WRITE]` remain separate preference memories (`avatar_memory`); profile documents stay excluded from that search.
- Restart the Agents Celery **website** worker after pulling task/code changes. A stale worker will reject `profiling.sync_profile` as unregistered.

### Strategist profile context (Supermemory primary)

`load_strategist_profile_context` GETs `avatar_<owned uuid>/document/profile`, requires usable non-empty `content` (and rejects processing/failed statuses), and injects `profile_context` + `profile_context_source` into `brand_profile` via `apply_strategist_profile_context` (with token-efficiency stripping of raw questionnaire / duplicate website fields). It does not append to `avatar_memory`. Chatbot uses this path when brand context is on; Playbook and context-off chatbot do not.

### Strategist memory retrieval

LinkedIn, Instagram, and X load durable preferences through `load_strategist_memory`. The helper searches Supermemory namespace `avatar_<owned uuid>` with `searchMode=hybrid` (so chunk-only documents remain searchable), the current user message (trimmed, max 500 characters), limit 8, and threshold 0.4. The search request includes a server-side metadata filter `origin=contos_avatar_memory` so profile document chunks cannot occupy the top-N hybrid slots. Hits may expose text as `memory` or `chunk`; both map into the flat avatar_memory shape. Client-side defense still excludes results with `metadata.kind=profile`, `metadata.origin=contos_profile`, or `metadata.source=contos_profile`. Duplicate kind+content pairs keep the highest-ranked hit. A successful empty search returns no memories and does not read historical `avatar_memory` rows. Timeouts, connection failures, HTTP errors, invalid responses, and missing configuration fall back to Supabase `load_avatar_memory`. Chatbot, playbook, and revise turns do not use this retrieval path. The client default for `search_memories` remains `searchMode=memories` with no filter for unrelated callers. Dedicated `PROFILE_READ` continues to use `GET …/document/profile` and is unaffected.

### Strategist memory writes

After draft grounding (`filter_memory_updates`), LinkedIn, Instagram, and X persist validated `memory_updates` through `save_memory_updates`. Writes go only to Supermemory (no new Supabase `avatar_memory` inserts, no dual write, no historical migration).

`filter_memory_updates` keeps quote grounding and adds durability checks against user-derived `allowed_norm` (latest user message + prior user turns + existing `source=user` memories; never assistant text): reject `source=inferred` + `kind=note`; reject session-meta / imperative one-off requests / scoped one-off phrasing (e.g. “just for this post”, “this time only”); require clear lexical evidence for remaining items (stricter for inferred). `save_memory_updates` also rejects inferred notes and temporary phrasing as defense in depth. Ambiguous proposals fail closed.

- Ownership is checked before any namespace is built; namespace is `avatar_<owned uuid>`
- Document id: `memory_document_id(kind, content)` (deterministic; repeats are idempotent)
- Content: validated durable memory text
- Metadata: `kind`, `source`, `platform` (or null), `origin=contos_avatar_memory`
- HTTP 409 is treated as success (document already present)
- Transient timeouts / connection failures / HTTP 408, 429, 5xx retry up to 3 attempts with short backoff; permanent client errors are not retried
- Write failures are logged (operation, status, error codes only) and never fail the agent response
- Missing Supermemory configuration skips the write and returns `[]`
- Profile sync (`document id=profile`) is unchanged and separate from these individual memory documents
- Explicit delete only: `delete_document` / `delete_documents` call `DELETE /ns/{namespace}/document` with `{"ids":[...]}`. Never invoked implicitly on MEMORY_READ/WRITE. Missing id (404) is success for single-id delete. Callers must already own the namespace.

### Memory supersession (current behavior + recommendation)

Document ids hash `kind` + normalized `content`, so an **updated preference with different wording creates a new document** and leaves the prior `mem_*` searchable. Exact duplicates remain idempotent (same id / 409). There is **no** automatic delete or supersede metadata today.

Recommended minimal lifecycle (not implemented unless product mandates it):

| Event | Intended behavior |
| --- | --- |
| New durable preference | `create_document` with new/existing `mem_*` |
| Exact duplicate | Same id; treat 409 as success |
| Updated preference (new wording) | Write new id; optionally delete prior id(s) only when the product UI/agent supplies exact old document ids after ownership check |
| Explicitly forgotten preference | Call `delete_document(namespace, exact_id)` after ownership — never search-and-delete by free text |
| Superseded preference | Prefer explicit forget + write, or a future optional `supersedes` metadata link — do **not** auto-purge by kind alone (would drop unrelated voice/goal siblings) |

### Profile synchronization

Supabase stores questionnaire answers (`profiling_data`) and optional `website_summary`. There is **no** LLM write to `profile_summary` on the completion path (historical values are left in place). After profiling completion, Celery `profiling.sync_profile` mirrors Q&A (+ website) into Supermemory. Avatar load does **not** trigger summarization (`maybe_refresh_stale_profile_summary` is a no-op). Historical avatars are not bulk-backfilled; re-run profiling (or force) to sync.

- Namespace: `avatar_<avatar uuid>`
- Document id: `profile`
- The sync task reloads the owned avatar and builds the document from that row
- Included: all meaningful questionnaire fields from `profiling_data`, plus `website_summary` when present
- Not included: competitor posts, scraped competitor data, analytics, embeddings, or an LLM `profile_summary`
- Metadata: `kind=profile`, `source=contos_profile`, and `source_hash` (SHA-256 of the document text)
- GET 200 reads `metadata.source_hash`. An equal hash skips PATCH. A different hash sends PATCH
- GET 404 creates document id `profile`. HTTP 409 from that POST sends one PATCH to the same id
- One Redis lock, `profile_sync:avatar:<id>`, expires after 90 seconds
- Retry policy unchanged (`PROFILE_SYNC_MAX_RETRIES`, backoff, Retry-After). Missing configuration does not retry
- Publish failure after the profiling lock releases still recovers in-process
- Configuration: `SUPERMEMORY_BASE_URL` and `SUPERMEMORY_API_KEY`

### Invoke body

```json
{
  "avatar_id": "uuid",
  "agent_type": "playbook | instagram | linkedin | twitter | chatbot",
  "user_input": "string",
  "live_mode": false,
  "chatbot_context_on": false,
  "competitor_url": null,
  "tagged_avatar_ids": ["uuid", "..."],
  "chat_history": [
    { "role": "user", "content": "prior message" },
    { "role": "assistant", "content": "prior reply" }
  ]
}
```

`chat_history` is optional. Backend keeps at most the last 12 user/assistant turns (2000 chars each) and injects them into the LLM messages for thread continuity.

`tagged_avatar_ids` are extra owned avatars. The API always keeps the active `avatar_id` and appends every tagged ID, then loads profile + competitor intel for each.

---

## 10. Environment variables

`backend/.env`:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Project URL (no `/rest/v1` needed) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** key (`sb_secret_…`) |
| `OPENROUTER_API_KEY` | LLM + embeddings |
| `LLM_MODEL` | `moonshotai/kimi-k2.6` |
| `PROFILE_SUMMARY_MODEL` | `google/gemini-2.5-flash` (profiling + website summary after onboarding) |
| `APIFY_API_TOKEN` | Website Content Crawler (shared with scrape Backend via env_loader) |
| `APIFY_WEBSITE_CRAWLER_ACTOR_ID` | Default `apify/website-content-crawler` |
| `WEBSITE_CRAWL_WAIT_SECS` / `WEBSITE_CRAWL_MAX_PAGES` / `WEBSITE_CRAWL_MAX_DEPTH` | Bounded onboarding crawl |
| `EMBEDDING_MODEL` | `openai/text-embedding-3-small` |
| `LLM_ENV` | Environment label |
| `PREFER_MOCK_DATA` | Must be `false` — tools use live Supabase only |
| `CHATBOT_MAX_TOKENS` / `AGENT_MAX_TOKENS` | Optional cap on completion length (blank = no limit) |
| `CORS_ORIGINS` | Allowed browser origins |

`frontend/.env`:

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE` | Empty = use Vite `/api` proxy |

---

## 11. How to run

```bash
# 1) Supabase SQL editor:
#    sql/001_agent_tables.sql
#    sql/002_rls_policies.sql
#    sql/003_content_summary_embeddings.sql  (optional RPC/index)
#    sql/005_agent_chat_stores.sql  (chat history JSONB + RLS)
#    Or apply repo migrations under supabase/migrations/

# 2) Backend (use port 8001 if 8000 is blocked on Windows)
cd contos-agents/backend
python -m venv .venv
.\.venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8001

# 3) Seed playbooks (once) + backfill summary embeddings
# POST http://127.0.0.1:8001/api/embeddings/store-playbooks
# POST http://127.0.0.1:8001/api/embeddings/backfill-summaries

# 4) Frontend
cd contos-agents/frontend
npm install
npm run dev
# → http://127.0.0.1:5173/
```

---

## 12. Performance notes (what we tuned)

| Optimization | Effect |
|--------------|--------|
| Instant greetings | No OpenRouter for `hi` / `hello` |
| Skip duplicate gather when avatar context exists | Cuts a second full RAG/embed pass (~5–15s) |
| Lexical competitor rank (`fast=True`) | Avoids OpenRouter embedding round-trips |
| Smaller context budget (`AGENT_MAX_CONTEXT_TOKENS=3500`) | Faster LLM prefill |
| `AGENT_MAX_TOKENS` default unset | Limits are set by the backend team; on a 402 the call retries within the affordable budget |
| 3–5 LinkedIn/Instagram ideas by default | Shorter generations |
| Async `agent_calls` logging | Don’t block SSE close |

Platform content generation is still model-bound on Kimi. Expect ~20–40s for LinkedIn/Instagram strategy asks after these cuts; add OpenRouter credits / a faster model if you need consistently under 20s.

---

## 13. Current status / known gaps

**Done**

- Full agent + MCP + SSE backend  
- Chatbot-first UI with platforms, toggle, competitor table  
- Playbooks embedded in Supabase via OpenRouter  
- Live `content_summaries.summary` + row embedding backfill  
- Agents **New chat** / **Previous chats** (browser `localStorage` cache + Supabase `agent_chat_stores` JSONB)  
- LLM **conversation memory** via client `chat_history` on invoke (last 12 turns)  

**Not done / placeholders**

- Real **Apify** scraping (today: resolve existing DB summaries)  
- Dedicated Reddit agent (today: chatbot + Reddit hint)  
- Richer `profiles` rows (today: falls back to `projects.name` / `type`)  

---

## 14. Security notes

- Never commit `.env` or paste secrets into chat/docs.  
- Rotate any keys that were shared in plaintext.  
- Prefer Supabase **secret** key for the backend; tighten RLS before production.  
- Frontend demo uses hard-coded demo `user_id` / `project_id` — replace with auth in production.

---

## 15. Quick mental model

> **Chat** = talk to ContOS.  
> **LinkedIn / Twitter / Instagram / Playbook** = ask for structured marketing output.  
> **Competitor table** = optional links fed into the prompt.  
> **Context toggle** = whether the chatbot uses brand + competitor data.  
> **MCP tools** = the only way agents load data.  
> **OpenRouter** = both Kimi (chat) and embeddings.
