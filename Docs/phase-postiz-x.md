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
| POST | `/api/postiz/posts` | Body `platform: "x"` sends `settings.__type = "x"`, `settings.who_can_reply_post = "everyone"`, and the X integration id. Types `now`, `schedule`, `draft` |

There is no ContOS X OAuth callback. Postiz callback remains `(X_URL or FRONTEND_URL)/integrations/social/x`.

X connect uses Redis key `postiz:x:snapshot:{avatar_id}`, separate from the LinkedIn snapshot.

## Validation

X media: at most 4 images, or exactly one `.mp4`. Image+video and two videos are rejected in ContOS. LinkedIn remains 10 images XOR 1 MP4.

X text length uses Postiz `GET /integration-settings/{id}` field `output.maxLength`, fetched only when creating or scheduling an X post, with that avatar's Postiz org token.

- `maxLength` exactly `4000` allows 1–4000 characters
- Any other value, a missing body, or a non-integer allows 1–280

This is the limit Postiz currently reports. It is not a live X Premium check. ContOS does not store a verified flag and does not call the X API. Postiz still validates the post on `POST /posts`.

`type=update` for X is rejected in this step and does not call integration-settings.

## Configuration

X app credentials stay on the Postiz host (`X_API_KEY`, `X_API_SECRET`, `X_URL`). They are not added to ContOS.

## Calendar UI

The Calendar page keeps the LinkedIn connection card and adds a separate X card for the same avatar. Switching avatars reloads both. Disconnect X calls `DELETE /api/postiz/integration?platform=x` and does not disconnect LinkedIn.

The composer defaults to LinkedIn, including edit. Choosing X sends `platform: "x"` for publish now, schedule, and draft. X hides update actions. Media validation uses 4 images XOR 1 MP4. The X character count is `content.length` and does not block submit; Postiz-reported `maxLength` remains the backend limit.

X posts on the shared calendar are the ones whose `integration_id` matches this avatar's connected X integration. Those posts do not open the update composer.

## List and upload

`list_posts` and `upload_media` use the avatar's LinkedIn id, X id, and the shared Postiz org token.

- List returns posts whose integration id matches either stored id. Null ids are ignored.
- Upload succeeds when LinkedIn or X is connected.
- Neither id still returns the existing not-connected error.
- Create, claim, and disconnect are unchanged.
- Another avatar's LinkedIn id is not treated as this avatar's X id.

## Limitations

- No threads, quotes, analytics, or X-native edit/delete
- Live X publish is not covered by these tests
