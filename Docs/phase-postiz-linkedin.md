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
- Status returns `{ connected, integration }` for **that avatar’s stored LinkedIn integration only**. `claim_candidates` is always empty for LinkedIn.
- ContOS does not show a LinkedIn account picker. A project binds a channel only when its own OAuth adds exactly one new LinkedIn integration. Existing channels in the org are not listed and cannot be selected.
- `POST` claim for LinkedIn is rejected. Cross-avatar claim remains rejected.
- If a stored integration id is missing from Postiz, status is `connected: false` and the stored id is kept. Other projects' LinkedIn channels are not offered.
- Do not use Postiz Groups as ContOS isolation.

## API endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/postiz/connect?avatar_id=` | Bearer Supabase JWT | Provision/ensure avatar org, snapshot, return LinkedIn URL |
| GET | `/api/postiz/status?avatar_id=` | Bearer Supabase JWT | `{ connected, integration }` for this avatar. LinkedIn `claim_candidates` is empty |
| POST | `/api/postiz/claim` | Bearer Supabase JWT | LinkedIn list selection is rejected. X claim is unchanged |
| GET | `/api/postiz/posts?avatar_id=&start_date=&end_date=` | Bearer | List calendar posts for this avatar’s LinkedIn only (includes `images`) |
| POST | `/api/postiz/upload?avatar_id=` | Bearer | Multipart `file` — avatar-scoped proxy to Postiz `/upload` (images max 10 MB; `video/mp4` max 1 GB) |
| POST | `/api/postiz/posts` | Bearer | Body `{ avatar_id, type, content, publish_date, post_id?, images? }` — `type`: `now` \| `schedule` \| `draft` \| `update`; `images` is the **complete final** MediaDto list (max 10) |
| PUT | `/api/postiz/posts/{post_id}/status` | Bearer | Body `{ avatar_id, status }` — `draft` \| `schedule` |
| DELETE | `/api/postiz/posts/{post_id}?avatar_id=` | Bearer | Delete a post owned by this avatar’s integration |
| DELETE | `/api/postiz/integration?avatar_id=` | Bearer | Disconnect LinkedIn for this avatar; keep Postiz org/token |
| POST | `/api/postiz/oauth/callback` | Bearer Supabase JWT | **410 Gone** — org consent replaced by provisioning |

### Calendar / publishing (Postiz public API mapping)

ContOS does **not** store posts or media blobs. It proxies to Postiz v2.23.0 `/api/public/v1`:

- `POST /upload` (multipart `file`) → `{ id, path, … }`
- `GET /media/:id` (org-scoped ownership check)
- `POST /posts` with `type: now | schedule | draft | update` and `value[].image: MediaDto[]`
- `GET /posts?startDate=&endDate=` (includes `image` for edit hydration)
- `DELETE /posts/:id`
- `PUT /posts/:id/status`
- `DELETE /integrations/:id` (disconnect)

Every ContOS call: verify avatar ownership → load `postiz_connections` by `avatar_id` → decrypt that avatar’s token → resolve LinkedIn from **stored** `postiz_integration_id` (never from the frontend). Mutate/delete first confirms the post’s `integration.id` matches that claimed id. Create/update with images verifies each media id via Postiz `GET /media/:id` for **that** org and requires path match.

**Media (LinkedIn images + MP4 video):**
- Max **10** images per post **or** exactly **1** `video/mp4` (not both). Text-only still uses `images: []`.
- ContOS upload validates **declared MIME + filename extension + size** only (`_MAX_IMAGE_BYTES` / `_MAX_VIDEO_BYTES`). Postiz performs content sniffing.
- ContOS still sends media through Postiz `value[].image` (MediaDto); no separate video field.
- Calendar UI: attach up to 10 images **or** exactly 1 MP4 (`<video controls>` preview for local blob / hydrated `.mp4` URL). Frontend validation is UX-only; ContOS backend remains authoritative.
- Frontend Calendar still reuses `uploadPostizMedia` (no separate video upload client).
- Edits send the **complete final** `images` array (e.g. existing `[A,B,C]` → remove B + add D → `[A,C,D]`; clear all → `[]`).
- Settings stay `{ "__type": "linkedin" }` without `post_as_images_carousel` (native LinkedIn multi-image, not PDF carousel).
- **Large-file limit (known):** ContOS `await file.read()` loads the whole file into memory; Postiz client read timeout is ~120s — not redesigned in this step.

**Step 4 — Mixed image + video (investigation only):**

> Postiz v2.23.0's LinkedIn provider explicitly rejects mixed image + video attachments.

Evidence: `_postiz-v2.23.0/libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts` → `LinkedinProvider.checkValidity` — if media length > 1 and any `path` contains `mp4`, returns `"Can have maximum 1 media when selecting a video."` (This documents our Postiz provider behavior, not a claim about LinkedIn’s underlying API.)

ContOS contract (unchanged; no ContOS/Postiz code changes from this investigation):

| Case | Result |
|------|--------|
| Images only: 0–10 images | ALLOWED |
| Video only: exactly 1 MP4 | ALLOWED |
| Images + 1 video (any mix) | REJECTED |
| 2+ videos (any mix) | REJECTED |

**Final rule:** ContOS contract: images XOR 1 MP4 video.

The upload/processing layer can individually process multiple media items, but that does not mean the LinkedIn provider supports publishing those mixed media items together. Do not bypass provider validation or call LinkedIn from ContOS.

### Upload 504 troubleshooting (Postiz storage)

ContOS waits synchronously for `POST {POSTIZ_URL}/api/public/v1/upload`.

**2026-09-23 retest (production `postiz.contos.now`):** authenticated ContOS-client uploads completed successfully end-to-end:

| Probe | Result |
|--------|--------|
| Unauthenticated `/api/public/v1/upload` | **401 in ~0.4s** |
| ContOS `PostizClient.upload_file` tiny PNG (3 avatars) | **201 in ~300–420ms** |
| ContOS client ~826KB JPEG | **201 in ~627ms** |

So the hang is **not** currently reproducible in auth → multer → `LocalStorage.uploadFile` → Prisma `saveFile`. Earlier nginx `upstream timed out` / HTML **504** (~60–75s) was real, but the live handler path above is fast with `STORAGE_PROVIDER=local`.

If 504 returns, Postiz now emits structured `upload_timing` logs (no tokens/contents). Interpret:

1. `auth_ok` then silence before `multipart_pipe_start` / `handler_start` → blocked in **FileInterceptor/multer** (body incomplete or stream stall).
2. `handler_start` then silence before `after_storage_uploadFile` → blocked in **storage** (`fromBuffer` / mkdir / write).
3. `after_storage_uploadFile` then silence before `after_saveFile` → blocked in **Prisma `media.create`**.
4. `after_saveFile` then nginx 504 → response/proxy issue after handler finished.

Postiz hardening applied: multer `limits.fileSize` = 1GB (matches video cap); temporary `upload_timing` logs around auth, pipe, storage, and Prisma.

On the Postiz VPS if it regresses:

1. `STORAGE_PROVIDER` / `UPLOAD_DIRECTORY` (confirm process env, not just compose file).
2. `docker logs` grep `upload_timing` during an upload.
3. Bypass proxy: `curl -m 15 -H "Authorization: pos_…" -F file=@tiny.png http://127.0.0.1:3000/public/v1/upload`.
4. Do **not** raise nginx timeouts until Postiz itself is slow but completing.

Regression test (Postiz tree):

```bash
pnpm exec jest libraries/nestjs-libraries/src/upload/local.storage.spec.ts --coverage=false
```

### Upload success but UI still fails (response path)

When Postiz `upload_timing` reaches `response_finished` (~150ms) but Calendar still shows
“Image upload failed…”, the failure is **after** Postiz storage — not a hang.

**Observed successful Postiz response**

| Layer | HTTP | Body shape |
|--------|------|------------|
| Postiz `POST /public/v1/upload` | **201 Created** (Nest default for POST) | `{ id, name, originalName, path, thumbnail, alt }` — `originalName` often `null` |
| ContOS `POST /api/postiz/upload` | **200 OK** | snake_case `MediaItemResponse`: `{ id, path, alt, thumbnail, name, original_name }` |

`PostizClient.upload_file` treats any status below 400 as success (201 is not an error). It logs
`status_code`, `response_keys`, `has_id` / `has_path` / `has_originalName` (never tokens or file bytes).
`_parse_media_ref` accepts both `originalName` and `original_name`.

**Frontend causes found**

1. **Race:** `queueMicrotask` ran `uploadAttachment(localId)` before React committed the new
   attachment, so `attachmentsRef` missed the entry → generic `mediaUploadFailed` without a
   lasting attachment update. Fix: sync `attachmentsRef.current` inside the updater and pass
   `file` as `fileOverride`.
2. **Sticky `formError`:** a failed race left the banner up even after a later success. Fix:
   `setFormError(null)` on successful upload.
3. **Parse:** ContOS already returns snake_case; `parseMediaItem` also accepts camelCase
   `originalName` and surfaces `HTTP status` + response keys if parse fails. `response.ok`
   is true for all 2xx — ContOS never returns 201 to the browser.

ContOS regression tests: `TestPostizUploadErrorSanitization` (201 body + ContOS 200 route).

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

### Calendar UI

`CalendarPage.tsx` lays the page out as a header (title, subtitle, Create post), a left card (LinkedIn and X rows with the account name under the title and the Connected badge, Connect another account only while exactly one of those two is connected, Create post, upcoming posts for the visible month), and a right card (Today, Month / Week / Day, platform filter, Sunday-first grid). Event chips are LinkedIn or X and show Published, Scheduled, Not published, Draft, or Failed from the Postiz state. Opening a failed post shows Delete; confirming it calls the existing delete endpoint. A queued post whose time has passed is Not published. Published posts stay on the day cell and are left out of Upcoming this month. Week and Day use the same chips for the visible range. Posts load only when at least one channel is connected. Connect, disconnect, create, edit, and delete still use the existing Postiz handlers. The create dialog is a shared composer for LinkedIn and X (platform cards, text toolbar, media drop zone). Publish now, schedule, and draft call the same handlers. No API or schema changes. Instagram is not a publishing channel.

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

Final LinkedIn automated QA results (2026-09-24): [linkedin-final-qa.md](./linkedin-final-qa.md).

## Monthly consistency

`GET /api/postiz/consistency?avatar_id=&month=YYYY-MM&timezone=` derives one calendar month from the avatar's Postiz `GET /posts` window. A day counts when at least one `PUBLISHED` LinkedIn or X root falls on that local date. Drafts, queued posts, errors, other integrations, and `intervalInDays` rows are ignored. `current_streak` is live for the current month only (today stays pending until local midnight if yesterday was posted) and is `null` for earlier months. `longest_streak` stays inside that month. No consistency table and no Redis. The sidebar row under the project switcher shows only `posted / days-in-month` and an arrow to the consistency page. It is hidden when the rail is collapsed. `/dashboard/:projectId/consistency` shows the current month. The previous six months load in a table (posting days, longest streak, LinkedIn days, X days, published posts); choosing a row opens that month. Timezone is the browser IANA zone on each request and is not stored.

## Known limitations

- Legacy user-scoped rows (`avatar_id IS NULL`) are not auto-migrated; reconnect per avatar.
- Provision 409 rotates only when Postiz indicates missing/unrecoverable token; other 409s propagate.
- Concurrent provision for the same avatar relies on Postiz locking + DB unique indexes.
- Postiz personal LinkedIn OAuth must request only scopes approved on the ContOS LinkedIn app (`openid`, `profile`, `w_member_social`). Broader scopes cause LinkedIn `unauthorized_scope` / “Bummer” before callback — see [postiz-linkedin-oauth-scopes-fix.md](./postiz-linkedin-oauth-scopes-fix.md).
- Personal LinkedIn authorize URL must **not** include `prompt=none` (silent session reuse on reconnect). ContOS `PostizClient` strips undocumented `prompt` from LinkedIn authorize URLs returned to the browser. Postiz source is also patched; deploy to the VPS when SSH is available. LinkedIn may still reuse an active browser session/grant; ContOS UX asks users to switch/sign out in the OAuth popup. Server-side LinkedIn token revoke is intentionally omitted (not in official 3-legged docs).
- Calendar must derive Postiz `avatar_id` from the URL `projectId` (never a stale `activeProject` from another avatar). See shell + CalendarPage fix for same-user multi-avatar isolation.
- Monthly consistency does not store a timezone or streak. The browser IANA zone is sent on each request. Streaks do not continue into the next month. A streak longer than the days already elapsed this month cannot be shown.
- `POST /posts` uses a 120s read timeout. Postiz keeps that request open until LinkedIn or X finishes, and the 30s default was returning HTTP 502 before a publish completed. Create is not retried, so a timed-out publish is not sent twice.
- Media uploads are not supported in ContOS v1 (text-only posts).
- Ownership lookup for mutate/delete uses a wide Postiz date window because Postiz public API has no `GET /posts/:id`.

## Future improvements

- Media upload support via Postiz upload API
- Admin tooling to inspect orphaned legacy rows
- Narrow post-ownership lookup if Postiz adds a public get-by-id endpoint
