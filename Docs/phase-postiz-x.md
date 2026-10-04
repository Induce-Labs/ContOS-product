# X backend foundation (Postiz)

## Purpose

Let one ContOS avatar keep a LinkedIn integration and a separate X integration on the same Postiz organization. ContOS starts Postiz OAuth and creates posts. Postiz performs OAuth 1.0a, scheduling, and X media upload.

## Storage

Migration `supabase/migrations/20260925000000_postiz_x_integration_id.sql` adds nullable `postiz_x_integration_id` on `postiz_connections`.

- Unique when non-null
- Does not change `postiz_integration_id` (LinkedIn)
- No second Postiz organization

## API

Omitted `platform` stays LinkedIn.

| Method | Path | X behavior |
| --- | --- | --- |
| GET | `/api/postiz/connect?avatar_id=&platform=x` | Ensures the avatar Postiz org, calls Postiz `GET /social/x`, returns `{ authorization_url, flow: "x" }` |
| GET | `/api/postiz/status?avatar_id=&platform=x` | `{ platform, connected, integration_id, integration, claim_candidates }` |
| POST | `/api/postiz/claim` | Body `platform: "x"` writes `postiz_x_integration_id` only when Postiz `identifier` is `x` |
| DELETE | `/api/postiz/integration?avatar_id=&platform=x` | Deletes that X channel in Postiz and clears only `postiz_x_integration_id` |
| POST | `/api/postiz/posts` | Body `platform: "x"` sends `settings.__type = "x"`, `settings.who_can_reply_post = "everyone"`, and the X integration id. Types `now`, `schedule`, `draft`. Optional `posts: [{ content }]` becomes one Postiz `value` array (first item is the post, later items are replies). `content` must equal the first entry's original text. Top-level `images` attach only to `value[0]`. |

There is no ContOS X OAuth callback. Postiz callback remains `(X_URL or FRONTEND_URL)/integrations/social/x`.

X connect uses Redis key `postiz:x:snapshot:{avatar_id}`, separate from the LinkedIn snapshot.

## Validation

X media: at most 4 images, or exactly one `.mp4`. Image+video and two videos are rejected in ContOS. LinkedIn remains 10 images XOR 1 MP4.

X text length uses Postiz `GET /integration-settings/{id}` field `output.maxLength`, fetched only when creating or scheduling an X post, with that avatar's Postiz org token.

- `maxLength` exactly `4000` allows 1–4000 characters
- Any other value, a missing body, or a non-integer allows 1–280

This is the limit Postiz currently reports. It is not a live X Premium check. ContOS does not store a verified flag and does not call the X API. Postiz still validates the post on `POST /posts`.

An omitted `posts` field keeps a single `value` item. When `posts` is set, each entry is checked with `len(entry.strip())` against that same limit. The Postiz payload stores the original string, including surrounding spaces. An entry that trims to empty is rejected. LinkedIn rejects `posts`.

`type=update` for X is allowed only when the owned post state is `DRAFT` or `QUEUE`. Published posts are rejected before the settings fetch. A draft or scheduled update still fetches `maxLength` once, sends the original content, and sets `value[0].id` to that post id so Postiz keeps the existing state.

## Configuration

X app credentials stay on the Postiz host (`X_API_KEY`, `X_API_SECRET`, `X_URL`). They are not added to ContOS.

## Calendar UI

The Calendar page keeps the LinkedIn connection card and adds a separate X card for the same avatar. Switching avatars reloads both. Disconnect X calls `DELETE /api/postiz/integration?platform=x` and does not disconnect LinkedIn.

The composer defaults to LinkedIn, including edit. Choosing X sends `platform: "x"` for publish now, schedule, and draft. The dialog layout is shared with LinkedIn; X create still starts as one text box and can add, remove, and reorder entries. Media still attaches to the first post only. Each entry shows `content.length` and does not block at 280 or 4000. Submit stays disabled while any entry trims to empty, media is uploading, or media is invalid. The request sends `content` as the first entry's original text and `posts` as every entry's original text. Media validation uses 4 images XOR 1 MP4 on the first entry only. Postiz-reported `maxLength` remains the backend limit, measured on trimmed text.

X posts on the shared calendar are the ones whose `integration_id` matches this avatar's connected X integration. A day shows three posts, and "+N more" expands that day so the rest can be opened. Clicking a published X post opens a read-only view. Clicking a draft (`DRAFT`) or scheduled (`QUEUE`) X post opens an editor for that root post's content, media, and date. The update uses Postiz `type: "update"` and the X integration id, so the draft or scheduled state is kept. Reply text is not in the calendar payload and is not edited. Delete and status changes stay LinkedIn-only.

## List and upload

`list_posts` and `upload_media` use the avatar's LinkedIn id, X id, and the shared Postiz org token.

- List returns posts whose integration id matches either stored id. Null ids are ignored.
- Upload succeeds when LinkedIn or X is connected.
- Neither id still returns the existing not-connected error.
- Create, claim, and disconnect are unchanged.
- Another avatar's LinkedIn id is not treated as this avatar's X id.

## Limitations

- X threads are one Postiz post: `value[0]` is the tweet and later `value` items are replies. ContOS does not schedule replies itself. Later entries cannot carry media. Draft (`DRAFT`) and scheduled (`QUEUE`) X posts can be edited as the root post and deleted. Published X posts stay view-only and cannot be deleted. Quotes and analytics are not supported.
- Live X publish is not covered by these tests
