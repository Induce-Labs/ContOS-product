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
- [AgentsPage.tsx](../src/pages/AgentsPage.tsx) loads the local cache, then `resolveChatStoreSync` unions sessions from this browser and `agent_chat_stores`. The same session keeps the newer copy. A browser with no chats does not delete the account row. A browser that still has chats uploads the merged store when the account row is missing or behind.
- Opening Chatbot shows the latest messages immediately, without a scroll animation. A reply keeps the view at the bottom only while the reader is already there.
- Remote upserts are debounced and skipped while SSE is streaming (tokens only hit `localStorage`)
- Sign-out **flushes** local chats to Supabase first, then clears the device cache; cloud rows restore on next sign-in
- Language is already on `user_profiles.preferred_language`. Theme, the collapsed sidebar, and the last opened project stay in this browser's `localStorage`

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
- `isAgentsWelcomeMessage` keeps personalized (and legacy) welcome text out of LLM history

### New chat / Previous chats

Visible in two places while on Agents:

1. **Sidebar (Competitors)** — primary **New chat** + **Previous chats**
2. **Main header** — same actions next to Research progress

**Previous chats** lists threads by title (first user message) and time. **New chat** archives the current thread when it has user messages.

Each visible message has a reply icon. Choosing it shows a short preview above the composer, which can be cancelled. The sent user message stores `replyTo` (`messageId`, role, and a clipped excerpt) and shows that quote. The quote scrolls to the original message when it is still in the thread. The saved bubble text stays what the user typed. Invoke history and `user_input` prefix that quote so the agent sees the link. New chat clears a pending reply.

The composer microphone uses the browser Web Speech API (`SpeechRecognition`, with `webkitSpeechRecognition` when that is the only one present). Click starts listening and click again stops. Speech is written into the current field after any text already typed, and the user edits and sends it. Words deleted while the microphone is on stay deleted; the next phrase appends to what is left in the field. Stopping with the mic button keeps the text already written and does not show the “no speech” message. While listening, a bubble above the mic says “Stop recording.” ContOS does not upload or store the audio. Chrome may send the audio to the browser vendor's speech service. Firefox has no `SpeechRecognition`. Brave and other Chromium browsers without a speech service fail with a network error. Both tell the user to open ContOS in Google Chrome or Microsoft Edge, or to type. The message has a close control. A denied microphone permission, another recognition error, or silence shows its own message and does not send.

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
- Draft edits stay in that same user-scoped chat row. Postiz writes use the open avatar id and the existing bearer token. Instagram is never posted.

## Known limitations

- Max 30 sessions / 80 messages per avatar (client-enforced).
- LLM memory is last 12 messages only.
- Concurrent edits of the same chat session: the newer session `updatedAt` wins. Different sessions from two browsers are kept together.

## Drafts sidebar

### Purpose

Review every generated post in the current chat, edit it, add one post to the chat to revise it, and schedule LinkedIn or X through Postiz.

### Implementation

- Reviewable bodies are stamped once into `output.review_posts` on the assistant message (`Frontend/src/lib/reviewableDrafts.ts`). The id, original text, and later edits live there. The existing chat save writes that message with the rest of the session. No new table. The chat no longer shows “Bold parts are suggestions…”; those posts are edited in this panel.
- A new chat is a new session, so it does not show the previous thread's drafts. The sidebar lists a reply only when the nearest user message asks for 2 to 7 days, a week, or more than one post (for example "5 posts" or "a few posts"). One post and a count of ideas stay in the chat. The same reply still renders in the chat. Deleting a card, or a successful Postiz save or schedule, hides that card. A failed or unconfirmed save stays in the sidebar. The local text Save does not remove it.
- One native array is used per agent: LinkedIn `post_ideas`, Instagram `content_calendar`, X `tweet_ideas` plus one card per thread. A thread is one card and one text box. A blank line still separates tweets when that card is saved or scheduled. Removing a card uses a trash icon and still asks for confirmation. The editor returns to the list through a Back button.
- The Drafts panel is a full-height column beside the chat. The agent pills, Drafts, and New chat stay in the chat column, so those buttons sit at the chat's right edge and shift left while the panel is open. A new assistant message with two or more posts opens it. The Drafts button toggles it, and the panel's close control dismisses it. Posts still needing review are counted on the Drafts button.
- Manual edits and an accepted revision update that message only. Accept, on the chat proposal, writes the revision into the draft editor and into the stored review post, including the platform field the chat card reads. Reject drops the proposal and leaves the editor as it was. A revision is accepted only when the reply has one clean body for that platform. Media stays on the post.
- Add to chat sits beside Back in the open draft. It replaces the sidebar refine field. It attaches that one draft to the composer and shows the opening of that post above the field. The sent instruction keeps that same preview, so the thread shows which draft the edit applies to. The next message is the instruction for that draft, and the proposed post appears in the chat with Accept and Reject. The proposal is the replacement post itself. A raw JSON payload is not shown. An instruction that is exactly “change X to Y”, “replace X with Y”, or “make X say Y” is applied in the browser when X is in the current post. There is no model call, so nothing else is added. If X is not in the post, the request still goes to the model.
- Every other edit sends optional `task: "revise"` on the existing `POST /api/agents/invoke` body. That call uses a short edit prompt: change only what the instruction asks, add text only when the user asked to add it, and do not invent facts, hashtags, or bold suggestions. It does not receive chat history or competitor context, and it skips the draft judge. The same one-replacement rule still applies.
- Those proposal messages stay in the transcript until you leave the thread. They do not become extra draft cards, and they are left out of later model history.
- Save draft and Schedule call the existing `POST /api/postiz/posts`. A saved post is updated with `type: 'update'`. A new X thread sends every tweet; an update of an existing X post changes the first tweet only, which is what that API allows.
- A network error or HTTP 5xx is `uncertain`. The next attempt lists that local day and adopts the post only when exactly one content match exists. Otherwise it does not create another post.
- A date with no time needs a time picked in the panel. Past or invalid times are skipped. The zone shown is the browser timezone.

### Postiz boundary

- Platforms sent to Postiz are LinkedIn and X only. Instagram cards can be edited and copied. They are not saved or scheduled, and `content_plan_items` is not read.
- Each card is scheduled on its own from the editor. The list shows that result as succeeded, failed, skipped, or unconfirmed.

### Limitations

- The chat store keeps the last 80 messages, so older cards leave with those messages.
- A literal refine matches the phrase exactly, including case, and replaces every occurrence. Any other wording is a revise model call.
- There is no batch Postiz endpoint.
- Local save can fail if storage is full; the remote upsert then shows the existing sync error.

## Future improvements

- Optional delete / rename in the Previous chats panel.
- Server-side compaction / retention policies.
