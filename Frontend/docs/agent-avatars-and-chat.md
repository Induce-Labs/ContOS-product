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
- Versioned store (`version: 2`) with `activeSessionId` + up to 30 sessions (80 messages each); structured `output` is kept so agent cards rehydrate
- [AgentsPage.tsx](../src/pages/AgentsPage.tsx) loads local → merges remote (cloud wins when local is welcome-only after logout) → upserts when local is newer
- Remote upserts are debounced and skipped while SSE is streaming (tokens only hit `localStorage`)
- Sign-out **flushes** local chats to Supabase first, then clears the device cache; cloud rows restore on next sign-in

### SQL

- Migration: [`supabase/migrations/20260830100000_agent_chat_stores.sql`](../../supabase/migrations/20260830100000_agent_chat_stores.sql)
- Manual copy: [`Agents/sql/005_agent_chat_stores.sql`](../../Agents/sql/005_agent_chat_stores.sql)
- RLS: `user_id = auth.uid()` plus owned-avatar check

### LLM conversation memory

- Builder: [Frontend/src/lib/agentChatMemory.ts](../src/lib/agentChatMemory.ts) — last **12** turns, **2000** chars each; skips welcome + empty/error assistants
- Frontend sends `chat_history` on `POST /api/agents/invoke` (prior turns only; excludes the new user message)
- Backend: [Agents/backend/chat_history.py](../../Agents/backend/chat_history.py) normalizes roles/length; [BaseAgent.build_messages](../../Agents/backend/agents/base_agent.py) interleaves turns and appends a `CONVERSATION MEMORY` block
- Instant chatbot greetings are skipped when `chat_history` is present

### Personalized welcome

- Empty chat shows a Claude-style centered heading only: ContOS mark + `Good morning, Sara` (time-aware)
- Name comes from Supabase auth metadata (`full_name` / `name` / `given_name`), else the email local-part
- Not rendered as a chat bubble; conversation bubbles appear after the first user message
- Empty threads refresh the greeting on open so the time-of-day line stays current
- While the agent is responding and no assistant content has arrived yet, pipeline stages (e.g. `calling_llm`) are hidden; a pulsing ContOS mark is shown with rotating waiting messages (localized, ~2.5s fade). The indicator is removed as soon as the first meaningful content or structured output appears, or when the stream/errors end.
- In **Chat**, naming exactly one of LinkedIn, Instagram, or X switches to that agent. Naming one other platform while LinkedIn, Instagram, or X is already selected switches to that agent the same way and answers with that platform's competitors. After a chip switch, the next specialist call does not receive the other platform's replies. Naming two or more, from Chat or from a content agent, switches the chip to general Chat and drafts each platform with its specialist, in order (LinkedIn, Instagram, X), as separate replies under a short plan line.
- Switching projects keeps the loading shell until that project's new empty chat is ready, so the previous project's thread is not painted in between. Previous threads stay in that project's Previous chats and are not copied to another project. The agent chip resets to general Chat.
- One-time reset: the first Agents load after this change deletes this user's local chat cache and their `agent_chat_stores` rows, then sets `localStorage` key `contos_agents_chat_reset_v1`. The flag is written only after the remote delete succeeds. Later visits do not wipe history.
- `isAgentsWelcomeMessage` keeps personalized (and legacy) welcome text out of LLM history

### New chat / Previous chats

Visible in two places while on Agents:

1. **Sidebar (Competitors)** — primary **New chat** + **Previous chats**
2. **Main header** — same actions next to Research progress

**Previous chats** lists threads by title (first user message) and time. **New chat** archives the current thread when it has user messages.

### Invoke wiring

Frontend sends `avatar_id`, optional `tagged_avatar_ids`, and optional `chat_history` on `POST /api/agents/invoke`.

`tagged_avatar_ids` are extra avatars from mention chips and `@Name` text ([agentMentions.ts](../src/lib/agentMentions.ts)). The Agents API unions those IDs with the active chat avatar, then loads **each** avatar’s `profiling_data` + competitor summaries. `@Name` stays in the message so the model can see who was tagged.

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
