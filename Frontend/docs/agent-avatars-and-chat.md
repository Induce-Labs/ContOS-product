# Agent avatars and chat retention

## Purpose

- Keep Agents chat history when navigating Dashboard ↔ Agents and across devices.
- Let users start a **New chat** and reopen **Previous chats** with visible controls.
- Tag other avatars with `@` so strategy asks can include multiple profiles.
- Send prior turns on each invoke so the LLM stays consistent within a thread.

## Implementation overview

### Chat sessions (UI + Supabase)

- **Source of truth:** Supabase table `agent_chat_stores` — **one JSONB row per `(user_id, avatar_id)`** (space-efficient vs per-message rows).
- **Local cache:** `contos_agents_chat:${userId}:${avatarId}` in `localStorage` for instant hydrate.
- Helpers: [Frontend/src/lib/agentChatStorage.ts](../src/lib/agentChatStorage.ts), [Frontend/src/lib/agentChatRemote.ts](../src/lib/agentChatRemote.ts)
- Versioned store (`version: 2`) with `activeSessionId` + up to 30 sessions (80 messages each); `output` blobs stripped before persist
- [AgentsPage.tsx](../src/pages/AgentsPage.tsx) loads local → merges remote by `updated_at` → upserts when local is newer or remote is empty
- Remote upserts are debounced and skipped while SSE is streaming (tokens only hit `localStorage`)
- Sign-out clears the **local** cache only; cloud rows remain for the next sign-in

### SQL

- Migration: [`supabase/migrations/20260830100000_agent_chat_stores.sql`](../../supabase/migrations/20260830100000_agent_chat_stores.sql)
- Manual copy: [`Agents/sql/005_agent_chat_stores.sql`](../../Agents/sql/005_agent_chat_stores.sql)
- RLS: `user_id = auth.uid()` plus owned-avatar check

### LLM conversation memory

- Builder: [Frontend/src/lib/agentChatMemory.ts](../src/lib/agentChatMemory.ts) — last **12** turns, **2000** chars each; skips welcome + empty/error assistants
- Frontend sends `chat_history` on `POST /api/agents/invoke` (prior turns only; excludes the new user message)
- Backend: [Agents/backend/chat_history.py](../../Agents/backend/chat_history.py) normalizes roles/length; [BaseAgent.build_messages](../../Agents/backend/agents/base_agent.py) interleaves turns and appends a `CONVERSATION MEMORY` block
- Instant chatbot greetings are skipped when `chat_history` is present

### New chat / Previous chats

Visible in two places while on Agents:

1. **Sidebar (Competitors)** — primary **New chat** + **Previous chats**
2. **Main header** — same actions next to Research progress

**Previous chats** lists threads by title (first user message) and time. **New chat** archives the current thread when it has user messages.

### Invoke wiring

Frontend sends `avatar_id`, optional `tagged_avatar_ids`, and optional `chat_history` on `POST /api/agents/invoke`.

## Env

- Frontend needs `VITE_AGENT_API_BASE_URL` (e.g. `http://127.0.0.1:8002`)
- Agents loads `Backend/.env` via [env_loader.py](../../Agents/backend/env_loader.py)

## Security

- Chat JSON is user-scoped via RLS; avatar ownership double-checked.
- `chat_history` on invoke is client-supplied but capped/validated server-side.
- No auth tokens stored in chat keys.
- Sync failures surface as an amber banner; chat still works from the local cache.

## Known limitations

- Max 30 sessions / 80 messages per avatar (client-enforced).
- LLM memory is last 12 messages only.
- Concurrent edits from two devices: last upsert wins (`updated_at`).

## Future improvements

- Optional delete / rename in the Previous chats panel.
- Server-side compaction / retention policies.
