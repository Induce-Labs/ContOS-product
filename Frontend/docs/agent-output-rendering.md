# Agent output rendering (ContOS Frontend)

## Purpose

Show Instagram / LinkedIn / Playbook / Twitter agent replies as readable strategy UI instead of raw JSON dumps in the Agents chat.

## Implementation overview

- `Frontend/src/components/agents/AgentOutputRenderer.tsx` — maps structured `complete` payloads into sections (analysis narrative, hooks, caption formulas, competitor cards, calendars, etc.).
- `Frontend/src/pages/AgentsPage.tsx` — stores structured `output` on assistant messages; skips streaming raw JSON tokens for non-chatbot agents; replaces content with the renderer on `complete`.
- `Agents/frontend` `OutputRenderer.jsx` — analysis mode also renders hooks, formulas, frequency, competitor insights, and differentiation (not only the `analysis` string).
- Instagram system prompt — strategy / insights asks use `response_type: "analysis"` with narrative `analysis` **plus** actionable list fields for the UI.

## Architecture decisions

- Keep backend JSON contract unchanged; fix presentation in the product UI.
- Do not stream partial JSON into the chat bubble for structured agents (status line / “Building your strategy…” instead).
- Chatbot remains plain-text streaming.

## API endpoints

No new endpoints. Uses existing `POST /api/agents/invoke` SSE `complete.output`.

## Schema / config

No database or env changes.

## Known limitations

- If JSON parse fails on the backend, the UI shows a parse warning + raw excerpt.
- Twitter chip is not in the main ContOS Agents chip list yet; renderer still supports Twitter payloads.
- Live OpenRouter invoke was not exercised in CI here without `Agents/backend/.env`; display regression is covered by `Frontend/scripts/test-agent-output-display.mjs`.

## Test

```bash
cd Frontend
node scripts/test-agent-output-display.mjs
```

## Future improvements

- Share one renderer package between ContOS Frontend and Agents demo frontend.
- Persist chat history with structured `output` blobs.
