# Postiz LinkedIn OAuth (Calendar)

## Purpose

Connect a Supabase-authenticated ContOS user to their own Postiz organization and LinkedIn channel, using ContOS Calendar as the only UI entry point. Postiz remains the social publishing infrastructure; ContOS never implements LinkedIn OAuth itself.

## High-level flow

### First connection

1. Calendar opens a popup and calls `GET /api/postiz/connect`.
2. ContOS stores a one-time OAuth `state` in Redis bound to the ContOS user, then returns Postiz frontend `/oauth/authorize` (with trusted `returnUrl` so Postiz login/register can resume consent).
3. User logs into or registers on Postiz if needed, then authorizes the ContOS OAuth app for their selected Postiz organization.
4. Postiz redirects the popup to ContOS `/auth/postiz/callback?code&state`.
5. ContOS backend validates/consumes state, exchanges the code server-side, encrypts and stores the `pos_...` organization token, then asks Postiz for a LinkedIn connect URL.
6. Popup continues through Postiz-owned LinkedIn OAuth. LinkedIn credentials stay in Postiz.
7. Parent Calendar polls `GET /api/postiz/status` until an enabled `linkedin` integration appears, then closes the popup.

### Subsequent LinkedIn connection / reconnection

1. Calendar opens a popup and calls `GET /api/postiz/connect`.
2. ContOS loads the user’s existing encrypted Postiz token, validates it via Public API, skips Postiz application consent, and returns Postiz’s LinkedIn URL.
3. Parent Calendar polls status as above.

## Architecture decisions

- ContOS identity is Supabase only (`get_current_user_id`). `/auth/callback` is unchanged.
- `POSTIZ_REDIRECT_URI` is immutable server config. Callback request bodies accept only `code` and `state` (`extra="forbid"`).
- One ContOS user → one Postiz connection row. Tokens never returned to the frontend.
- Status returns `{ "connected": boolean, "channels": [{ "id", "provider", "name" }] }` for enabled LinkedIn integrations (`identifier === "linkedin"` and `disabled === false`). `name` is the Postiz display name for that LinkedIn channel.
- Postiz v2.23.0 Public API LinkedIn connect has no caller `return_url`; ContOS detects success by polling and closes the popup.

## API endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/postiz/connect` | Bearer Supabase JWT | Start Postiz consent or resume LinkedIn connect |
| POST | `/api/postiz/oauth/callback` | Bearer Supabase JWT | Exchange code, store token, return LinkedIn URL |
| GET | `/api/postiz/status` | Bearer Supabase JWT | `{ "connected": true\|false, "channels": [...] }` |

Responses never include Postiz access tokens, client secrets, or authorization codes.

## Database

Migration: `supabase/migrations/20260921000000_postiz_connections.sql`

Table `public.postiz_connections`:

- `contos_user_id` unique FK → `auth.users`
- `postiz_organization_id`
- `encrypted_access_token` (Fernet)
- timestamps

RLS enabled with **no** browser policies. Backend uses service role and always filters by authenticated user id.

## Configuration

Backend only (`Backend/.env`):

```
POSTIZ_URL=https://postiz.contos.now
POSTIZ_CLIENT_ID=pca_WSXwf9ZdqpFrK1Vf3YOtrk1CfA0tybAm
POSTIZ_CLIENT_SECRET=<secret>
POSTIZ_REDIRECT_URI=http://localhost:5173/auth/postiz/callback
POSTIZ_TOKEN_ENCRYPTION_KEY=<fernet key>
```

Generate a Fernet key:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Apply the SQL migration to the ContOS Supabase project before testing.

## Frontend

- Route: `/auth/postiz/callback` (separate from Supabase `/auth/callback`)
- Calendar: `/dashboard/:projectId/calendar` — **primary UI is LinkedIn connect/status** (connect CTA, connected account name, reconnect/refresh). Content scheduling remains a secondary note until built.
- No Postiz sidebar item, no Postiz dashboard, no other networks
- Parent Calendar never navigates away; OAuth runs in a popup with status polling
- Status response includes `channels` so Calendar can show which LinkedIn account is connected

## Security

- ContOS OAuth state: random, Redis hash-keyed, 10-minute TTL, atomic consume, user-bound
- No logging of codes, tokens, secrets, or sensitive OAuth query values
- Navigation URLs validated to Postiz origin or LinkedIn OAuth host
- User A cannot read User B’s connection row or use User B’s token
- Frontend env must not contain Postiz secrets (guarded by tests)

## Local test plan

1. Set backend Postiz env vars; ensure Redis is up; apply migration.
2. Sign in to ContOS as User A; open Calendar; confirm `connected: false`.
3. Click Connect LinkedIn (allow popups). Verify Postiz login/register appears when no Postiz session exists, then ContOS app consent.
4. Approve ContOS; complete LinkedIn in the popup; confirm Calendar’s primary card shows the LinkedIn account name (not a Coming Soon hero) and popup closes.
5. Repeat for User B in a separate browser profile; verify isolation.
6. With an existing Postiz token but no LinkedIn channel, confirm consent is skipped and LinkedIn starts directly.
7. Deny / close popup / timeout paths show retryable errors.
8. Confirm Supabase login/logout and `/auth/callback` still work.

Automated:

```bash
cd Backend
pip install -e ".[dev]"
pytest tests/test_postiz.py tests/test_phase6_hardening.py -q
```

## Known limitations

- Postiz v2.23.0 does not return LinkedIn OAuth to ContOS; parent polling closes the popup.
- Postiz Public API GET integrations/social are not throttled by the app’s POST-posts guard; ContOS uses a 5-second status cache for load smoothing.
- One Postiz OAuth app has one redirect URL; switch local vs production carefully.
- Losing `POSTIZ_TOKEN_ENCRYPTION_KEY` makes stored tokens undecryptable.

## Future improvements

- Expand status to return safe channel metadata.
- Production redirect URI + Postiz app redirect update.
- Encryption key rotation procedure.
- Optional Postiz upgrade for LinkedIn `return_url` if available in a later version.
