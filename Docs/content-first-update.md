# ContOS: Content-First Drafts Update

This update responds to the team feedback: no brackets, longer drafts that follow the competitor's format, and a product focused on content generation and posting more than strategy.

## What changed for the user

| Feedback | What ContOS does now |
|---|---|
| Remove the `[brackets]` | Drafts contain no brackets. Where a detail is missing, the assistant writes a relevant suggestion in **bold** instead. |
| Let the user change the suggestion | The user can reply with their own wording, for example "change the first bold part to something about AI". Only that part changes. |
| Finalize the post | The user says "confirm". The bold markers are removed and the text becomes normal. No model call is made, so it is instant and free. |
| Drafts should be longer and follow competitor format | Length and layout come from the competitor's real scraped posts: typical word count, words per line, and blank-line spacing. On the test avatar (39 posts) the typical post is 226 words. |
| Product is content generation and posting | Content requests return a finished post in the same turn. Ideas requests include one full draft. Weekly plans include a full draft per slot. |

## How the bold suggestions work

1. The user asks for a post, for example "write a LinkedIn post about my AI agent work".
2. The assistant returns a complete post. Facts the user gave are normal text. Details the user did not give are in **bold**.
3. The user edits the bold parts by chat, or says "confirm".
4. After "confirm", the post is shown as normal text. The Copy button also strips the markers.

Rules on suggestions:
- At most 5 bold spans per draft.
- Suggestions describe general situations. They never invent statistics, results, awards, clients, revenue, customer quotes or named people.
- The draft checker (LLM judge) treats bold as editable suggestions. It still rejects invented numbers, results, quotes and named people outside the user's facts.
- Facts the user gave are never bolded.

## Response presentation refinements

- **No em dashes:** Chatbot prompts ban `—` / `–`; greetings avoid them; the chat formatter replaces any remaining ones with commas before display.
- **Section dividers:** Deep answers use a `---` line between sections. The UI renders that as a hairline rule (not dots or ellipsis).
- **Platform auto-switch:** Naming exactly one of LinkedIn / Instagram / X in Chat switches to that agent (bare name switches the chip only; a content ask invokes that agent in the same turn). Multiple platforms or none stay on Chat.
- **Hidden in the UI:** thesis / Angle, per-item and playbook reasoning, and the AI-generated draft disclaimer footer. The backend no longer injects the disclaimer.
- **Language consistency (en / hi / es / fr / zh):** RESPONSE LANGUAGE rules ban English ContOS jargon in non-English prose; `suggestionHint` and confirm detection use localized confirm verbs; content-type badges are translated via `agents.output.contentTypes`.

## Locked reply format (Shape A & Shape B)

All agent responses now enforce one of two strict format shapes to maintain consistency and clarity:

**Shape A (Draft responses):**
- Short intro sentence acknowledging the request (e.g., "Got it, LinkedIn. Here's a draft...")
- Hairline divider (`---`)
- Plain draft body with NO "POST IDEAS" or content-type badge chrome
- Hairline divider (`---`)
- Follow-up question in left-border quote style

**Shape B (Strategy/Insights responses):**
- Short intro sentence
- Scannable body with **bold labels:** followed by bullets or short sentences
- Brief synthesis sentence
- Follow-up question

**Strict eliminations:**
- No thesis blocks or reasoning paragraphs in replies
- No disclaimer text
- No em dashes (`—`) or en dashes (`–`) anywhere
- No ellipsis (`...`) or dot dividers (`···`)

**Platform redirect messages:**
Concise switch indicators across all 5 languages:
- **en:** `Agent switched to {{platform}}`
- **hi:** `एजेंट {{platform}} पर स्विच किया गया`
- **es:** `Cambiado a {{platform}}`
- **fr:** `Basculé vers {{platform}}`
- **zh:** `已切换至 {{platform}} 助手`

These rules are locked in all backend prompts (`strategist_core.py`, `chatbot.py`, `linkedin.py`, `instagram.py`, `twitter.py`) and enforced regardless of user queries. The model cannot deflect or override these format requirements.

## Other behavior

- **Weekly plan:** 2-3 posts, each a full draft with its own opening and closing line.
- **Monthly request:** a vision of 4 weekly themes only, with no month of posts. The full monthly schedule is v2.
- **X (Twitter):** a hard limit of 280 characters per tweet, checked in code. An over-long tweet triggers one retry.
- **Fresh posts:** drafts must not reuse openings or closing lines from earlier drafts in the same conversation.
- **Memory:** the assistant never saves its own suggestions as facts about the user.
- **Token limits:** none are set in code. Tokens are logged per call, and the backend team decides the limits.

## Fixes found while testing

- The chat history sent back to the model had only each idea's hook line. It now includes the full reply and draft text, with the per-message limit raised from 2000 to 5000 characters. The Agents API `ChatHistoryTurn` max length must match that 5000 limit; otherwise FastAPI returns 422 on the next invoke after a long reply.
- A tweet came out at 365 characters. A length check and retry now handle this.
- A weekly "Monday" post copied an earlier draft, and posts repeated the same closing line. The prompt now forbids this.
- A schema hint was echoed as the draft type. This is now cleaned up.

## Verification

- Backend: 104 tests pass. 2 fail in `test_translate`, and they also fail on upstream `main`.
- Frontend: typecheck and build pass. 45 tests pass for the bold, confirm and platform-switch logic.
- Live runs on the real model, using the test avatar with real competitors:
  - A LinkedIn post of about 231 words (competitor typical: 226) with no brackets.
  - A user edit of the first bold part was applied correctly.
  - Ideas turns included a full draft.
  - Weekly plans gave 3 full drafts.
  - A monthly request gave an outline only.
  - A tweet fit within 280 characters.

## Known gaps

- Weekly drafts run 129-147 words against the typical 226.
- First-person claims about the user's own practice that appear outside bold are not caught yet.
- The bold rendering and the confirm step are covered by unit tests, but not yet checked in a browser.
- The dev test page shows raw `**`.
- The Schedule button is not yet disabled while bold suggestions remain. The Postiz code has not been inspected.
- Instagram and X do not use competitor style yet. Only LinkedIn does.
- Two Supabase migrations are still to be run: `evidence_citations` and `copy_paste_post` on `content_plan_items`, and the `avatar_memory` table.

## Quick UI test (about 5 minutes)

1. Open the LinkedIn agent and ask: "Write a post about something I'm building". Check that there are no brackets, that the post is about the competitor's length, and that the suggestions are bold.
2. Reply: "Change the first bold part to <your own text>". Only that part should change.
3. Reply: "confirm". The bold should disappear with no loading delay.
4. Press Copy. The pasted text should contain no `**`.
5. Ask the X agent for a tweet. It should be 280 characters or fewer.
6. Ask for a weekly plan. It should show 2-3 full posts, each with its own opening and closing line.
7. Ask for a monthly plan. It should show 4 weekly themes and no posts.
