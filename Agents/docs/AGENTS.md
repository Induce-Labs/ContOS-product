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
| Chatbot max tokens | `CHATBOT_MAX_TOKENS` (default 350) |
| Platform agent max tokens | `AGENT_MAX_TOKENS` (default 1800) |

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
| `POST` | `/api/embeddings/store-playbooks` | Embed + store mock playbooks |
| `GET` | `/api/mcp/tools` | List MCP tool schemas |

### Invoke body

```json
{
  "user_id": "uuid",
  "project_id": "uuid",
  "agent_type": "playbook | instagram | linkedin | twitter | chatbot",
  "user_input": "string",
  "live_mode": false,
  "chatbot_context_on": false,
  "competitor_url": null
}
```

---

## 10. Environment variables

`backend/.env`:

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Project URL (no `/rest/v1` needed) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** key (`sb_secret_…`) |
| `OPENROUTER_API_KEY` | LLM + embeddings |
| `LLM_MODEL` | `moonshotai/kimi-k2.6` |
| `EMBEDDING_MODEL` | `openai/text-embedding-3-small` |
| `LLM_ENV` | Environment label |
| `PREFER_MOCK_DATA` | Must be `false` — tools use live Supabase only |
| `CHATBOT_MAX_TOKENS` / `AGENT_MAX_TOKENS` | Cap completion length |
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
| Short chat skips heavy RAG | Faster chatbot replies |
| Live `content_summaries.summary` | Agents use real competitor intel |
| Local cosine when RPC missing | Still ranks stored row embeddings |
| `max_tokens` caps | Shorter generations |
| Async `agent_calls` logging | Don’t block SSE close |
| No `stream_options` retry | Avoid double OpenRouter request |

Platform content generation (full LinkedIn calendars, etc.) is still slower — that is model generation time on Kimi.

---

## 13. Current status / known gaps

**Done**

- Full agent + MCP + SSE backend  
- Chatbot-first UI with platforms, toggle, competitor table  
- Playbooks embedded in Supabase via OpenRouter  
- Live `content_summaries.summary` + row embedding backfill  

**Not done / placeholders**

- Real **Apify** scraping (today: resolve existing DB summaries)  
- Real Gemini summary pipeline wired into agents  
- Auth (JWT → `user_id`)  
- Persistent chat history  
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
