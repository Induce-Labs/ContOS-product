# Postiz LinkedIn + content calendar (avatar-scoped)

## Purpose

Connect a Supabase-authenticated ContOS **avatar** to its own dedicated Postiz organization and LinkedIn channel, then schedule/publish/edit LinkedIn posts from ContOS Calendar. Postiz remains the social publishing infrastructure; ContOS never implements LinkedIn OAuth or a duplicate posts database.

## High-level flow

### Connect LinkedIn for an avatar

1. Calendar (route `/dashboard/:projectId/calendar`) opens a popup and calls `GET /api/postiz/connect?avatar_id=<uuid>`.
2. ContOS verifies `avatars.id = avatar_id` and `avatars.user_id =` authenticated user.
3. ContOS ensures a dedicated Postiz org via server-to-server `POST /api/internal/contos/provision-avatar` (Approach B). The browser never sees `CONTOS_PROVISION_SECRET` or raw `pos_` tokens.
4. ContOS encrypts and stores the token against **that avatar**, snapshots current LinkedIn integration ids in Redis, and returns Postiz’s LinkedIn connect URL (`flow=linkedin`).
5. Popup continues through Postiz-owned LinkedIn OAuth. LinkedIn credentials stay in Postiz.
6. Parent Calendar polls `GET /api/postiz/status?avatar_id=<uuid>` until an enabled `linkedin` integration is claimed for that avatar, then closes the popup.

### Subsequent connection / reconnection

1. Same connect endpoint with `avatar_id`.
2. ContOS reuses the avatar’s encrypted token when valid; re-provisions only if missing/invalid.
3. Returns LinkedIn URL; parent polls status for **that avatar only**.

Org-consent OAuth (`POST /api/postiz/oauth/callback`) is **deprecated** (HTTP 410). Legacy `postiz_connections` rows with `avatar_id IS NULL` remain untouched and are never reused for new avatar connects.

## Architecture decisions

- ContOS identity is Supabase only (`get_current_user_id`). `/auth/callback` is unchanged.
- **One avatar → one Postiz connection** (partial unique index on `avatar_id`). One Postiz org → one avatar (unique on `postiz_organization_id`). One LinkedIn integration → one avatar (partial unique on `postiz_integration_id`).
- Tokens never returned to the frontend. Provision secret stays backend-only.
- Status returns `{ connected, integration, claim_candidates }` for **that avatar’s stored LinkedIn integration only**.
- Cross-avatar claim is rejected. Claim candidates are only unbound LinkedIns in **this** avatar’s org during an active Redis snapshot.
- If a stored integration ID is temporarily missing from Postiz, status is `connected: false` but the DB id is **kept**.
- Do not use Postiz Groups as ContOS isolation.

## API endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/postiz/connect?avatar_id=` | Bearer Supabase JWT | Provision/ensure avatar org, snapshot, return LinkedIn URL |
| GET | `/api/postiz/status?avatar_id=` | Bearer Supabase JWT | `{ connected, integration, claim_candidates }` for this avatar |
| POST | `/api/postiz/claim` | Bearer Supabase JWT | Body `{ avatar_id, integration_id }` — bind one unclaimed LinkedIn |
| GET | `/api/postiz/posts?avatar_id=&start_date=&end_date=` | Bearer | List calendar posts for this avatar’s LinkedIn only |
| POST | `/api/postiz/posts` | Bearer | Body `{ avatar_id, type, content, publish_date, post_id? }` — `type`: `now` \| `schedule` \| `draft` \| `update` |
| PUT | `/api/postiz/posts/{post_id}/status` | Bearer | Body `{ avatar_id, status }` — `draft` \| `schedule` |
| DELETE | `/api/postiz/posts/{post_id}?avatar_id=` | Bearer | Delete a post owned by this avatar’s integration |
| DELETE | `/api/postiz/integration?avatar_id=` | Bearer | Disconnect LinkedIn for this avatar; keep Postiz org/token |
| POST | `/api/postiz/oauth/callback` | Bearer Supabase JWT | **410 Gone** — org consent replaced by provisioning |

### Calendar / publishing (Postiz public API mapping)

ContOS does **not** store posts. It proxies to Postiz v2.23.0 `/api/public/v1`:

- `POST /posts` with `type: now | schedule | draft | update`
- `GET /posts?startDate=&endDate=`
- `DELETE /posts/:id`
- `PUT /posts/:id/status`
- `DELETE /integrations/:id` (disconnect)

Every ContOS call: verify avatar ownership → load `postiz_connections` by `avatar_id` → decrypt that avatar’s token → resolve LinkedIn from **stored** `postiz_integration_id` (never from the frontend). Mutate/delete first confirms the post’s `integration.id` matches that claimed id.

**Timezone:** ContOS requires ISO-8601 datetimes with an explicit offset (`Z` or `±HH:MM`). The frontend builds them from the user’s local wall-clock time and ContOS passes `publish_date` through unchanged as Postiz `date`. ContOS does not convert to UTC or shift the scheduled time.

**Disconnect:** Deletes only that avatar’s LinkedIn integration in Postiz (Postiz cascades that channel’s scheduled/draft posts). Clears `postiz_integration_id` only. Keeps org + encrypted token so the avatar can reconnect. Does not affect other avatars and does not log the user out of LinkedIn globally.

## Database

Migrations:

- `supabase/migrations/20260921000000_postiz_connections.sql` (legacy create)
- `supabase/migrations/20260921010000_postiz_integration_id.sql`
- `supabase/migrations/20260922000000_postiz_connections_avatar_scope.sql`

Table `public.postiz_connections`:

- `contos_user_id` FK → `auth.users` (ownership; **not** unique)
- `avatar_id` nullable FK → `public.avatars(id) ON DELETE CASCADE` (null = legacy)
- Partial unique index on `avatar_id WHERE NOT NULL`
- Unique index on `postiz_organization_id` (migration fails clearly if duplicates exist)
- `encrypted_access_token` (Fernet)
- `postiz_integration_id` (nullable; partial unique when set)

RLS enabled with **no** browser policies. Backend uses service role and always filters by `avatar_id` after ownership checks.

## Configuration

Backend only (`Backend/.env`):

```
POSTIZ_URL=https://postiz.contos.now
CONTOS_PROVISION_SECRET=<shared secret with Postiz>
POSTIZ_TOKEN_ENCRYPTION_KEY=<fernet key>
# Optional / Postiz-side OAuth app (not used for ContOS org-token exchange anymore)
POSTIZ_CLIENT_ID=pca_...
POSTIZ_CLIENT_SECRET=
POSTIZ_REDIRECT_URI=http://localhost:5173/auth/postiz/callback
```

Generate a Fernet key:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Apply all Postiz SQL migrations to ContOS Supabase before testing. Postiz must expose Approach B routes (see [postiz-contos-provision.md](./postiz-contos-provision.md)).

## Frontend

- Calendar: `/dashboard/:projectId/calendar` — URL `projectId` is the ContOS avatar id; `CalendarPostizPanel` remounts with `key={avatarId}`
- Month view loads posts only for that avatar; switching avatars clears events then refetches
- Create / edit modal: text-only publish now, schedule, draft, update, status change, delete
- Disconnect LinkedIn with explicit warning about Postiz removing that channel’s posts
- Popup opens LinkedIn URL directly (no ContOS org-consent callback step)
- `/auth/postiz/callback` shows a deprecated message if hit
- No Postiz secrets in Vite env

## Security

- Ownership: `verify_avatar_owner` before every connect/status/claim/posts/disconnect
- Redis keys: `postiz:status:{avatar_id}`, `postiz:linkedin:snapshot:{avatar_id}`
- No logging of raw `pos_` tokens or provision secrets
- Navigation URLs validated to Postiz origin or LinkedIn OAuth host
- User A cannot use User B’s `avatar_id`; Avatar A never decrypts Avatar B’s token
- Post mutate/delete rejected unless the post belongs to the avatar’s claimed LinkedIn integration
- Frontend must not send org/token/integration ids for publishing — ContOS resolves them server-side
- Frontend env must not contain Postiz secrets (guarded by tests)

## Local test plan

1. Set `CONTOS_PROVISION_SECRET`, `POSTIZ_URL`, encryption key; ensure Redis is up; apply migrations.
2. Sign in; open Calendar for Avatar A; confirm `connected: false`.
3. Connect LinkedIn; confirm Calendar shows the LinkedIn account for Avatar A only.
4. Create schedule/draft/publish-now posts; confirm they appear only on Avatar A’s month view.
5. Switch to Avatar B; confirm empty/disconnected calendar (no stale A events).
6. Disconnect Avatar B; confirm A and C still connected; reconnect B without re-provisioning org.
7. Confirm User B cannot status/connect/posts with User A’s avatar id (404).

Automated:

```bash
cd Backend
pip install -e ".[dev]"
pytest tests/test_postiz.py tests/test_phase6_hardening.py -q
```

## Known limitations

- Legacy user-scoped rows (`avatar_id IS NULL`) are not auto-migrated; reconnect per avatar.
- Provision 409 rotates only when Postiz indicates missing/unrecoverable token; other 409s propagate.
- Concurrent provision for the same avatar relies on Postiz locking + DB unique indexes.
- Postiz personal LinkedIn OAuth must request only scopes approved on the ContOS LinkedIn app (`openid`, `profile`, `w_member_social`). Broader scopes cause LinkedIn `unauthorized_scope` / “Bummer” before callback — see [postiz-linkedin-oauth-scopes-fix.md](./postiz-linkedin-oauth-scopes-fix.md).
- Calendar must derive Postiz `avatar_id` from the URL `projectId` (never a stale `activeProject` from another avatar). See shell + CalendarPage fix for same-user multi-avatar isolation.
- Media uploads are not supported in ContOS v1 (text-only posts).
- Ownership lookup for mutate/delete uses a wide Postiz date window because Postiz public API has no `GET /posts/:id`.

## Future improvements

- Media upload support via Postiz upload API
- Admin tooling to inspect orphaned legacy rows
- Narrow post-ownership lookup if Postiz adds a public get-by-id endpoint
