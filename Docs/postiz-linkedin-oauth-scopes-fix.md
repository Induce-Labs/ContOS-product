# Postiz LinkedIn OAuth — unauthorized scopes fix

## Root cause

LinkedIn authorize for ContOS returned **HTTP 200** with **"Bummer, something went wrong"** / `unauthorized_scope` because Postiz `LinkedinProvider` requested scopes the ContOS LinkedIn app does not have:

| Scope | Result on ContOS app |
| --- | --- |
| `openid` `profile` `w_member_social` | OK (LinkedIn 303 → login/consent) |
| `r_basicprofile` | **unauthorized_scope** |
| `rw_organization_admin` / `w_organization_social` / `r_organization_social` | **unauthorized_scope** |

Redirect URI (`https://postiz.contos.now/integrations/social/linkedin`), client id presence, and ContOS→Postiz provision/org context were fine. The failure happened **on LinkedIn’s authorize page** before callback; Postiz never created the integration (hence ContOS status kept polling empty integrations).

## Fix (minimal)

In Postiz `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts`:

1. Set personal LinkedIn scopes to `openid`, `profile`, `w_member_social` only.
2. Soft-fail `/v2/me` vanity lookup (needs `r_basicprofile`); use OpenID `userinfo` for identity.

`LinkedinPageProvider` (company pages) keeps broader org scopes — ContOS Calendar uses personal `linkedin` only.

## Deploy to VPS

SSH is required (this agent environment has no VPS private key under `~/.ssh`). From a machine that can `ssh -p 7576 root@103.135.230.110`:

```bash
# From ContOS repo root — copy the patched personal LinkedIn provider
scp -P 7576 \
  "_postiz-v2.23.0/libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts" \
  root@103.135.230.110:/path/to/postiz/libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts

ssh -p 7576 root@103.135.230.110 'cd /path/to/postiz && docker compose build backend && docker compose up -d backend'
```

Local patched file:

`_postiz-v2.23.0/libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts`

### ContOS UX (no LinkedIn account picker available)

**Live evidence:** `GET /api/public/v1/social/linkedin` returns an authorize URL with
`response_type=code`, `client_id`, `redirect_uri`, `state`, `scope=openid profile w_member_social`,
and **no** `prompt=none`. ContOS opens that URL in a named popup (`contos-postiz-oauth`).

When the browser already has a LinkedIn session **and** an existing app grant, LinkedIn’s
documented behavior is to **bypass** login/consent and immediately redirect to `redirect_uri`
with a code — the popup never presents a switch UI. ContOS only closes the popup after status
polling sees `connected` (it does not skip LinkedIn).

Official docs: “If there is an existing permission grant from the member: the authorization
screen is bypassed…” ([Authorization Code Flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)).
No documented `prompt` / `login_hint` / federated logout for this flow.

Calendar UX therefore:

1. Shows a **pre-connect** confirmation: LinkedIn may auto-use the signed-in account; sign out or switch **before** continuing (not “inside the popup,” which may flash closed).
2. Opens OAuth in a popup; binds whatever LinkedIn returns to the **current avatar** only.

ContOS `PostizClient.get_linkedin_authorization_url` strips undocumented `prompt`
from LinkedIn authorize URLs so Calendar reconnect works even if a stale Postiz
image still emits `prompt=none`. Postiz source must still omit `prompt=none`.

```bash
cd Backend
.venv/Scripts/python.exe scripts/verify_postiz_linkedin_auth_url.py
```

Expect `OK: ContOS LinkedIn authorize URL has no prompt=none and expected scopes`.

Then: Avatar A → Disconnect → sign out of LinkedIn in the browser if you want another account → Connect LinkedIn.

## Verify

1. Call `GET /api/public/v1/social/linkedin` with a ContOS-provisioned `pos_` token (or ContOS `GET /api/postiz/connect?avatar_id=`).
2. Confirm auth URL `scope=` is only `openid profile w_member_social`.
3. Confirm auth URL does **not** contain `prompt=none`.
4. Opening that URL must **not** show LinkedIn “Bummer”; it should show Sign in / Allow (or consent).
5. After Allow, Postiz callback adds the channel; ContOS `GET /api/postiz/status?avatar_id=` becomes `connected: true`.

## Reconnect after disconnect — `prompt=none` removed

### Symptom

Avatar disconnects LinkedIn (Postiz soft-delete + ContOS clears `postiz_integration_id`), then Connect again silently rebinds the **same** LinkedIn account.

### Root cause

Personal `LinkedinProvider.generateAuthUrl()` included undocumented `prompt=none`. LinkedIn also reuses an active browser session and existing app grant when present. ContOS isolation was not wrong.

### Fix

1. Remove `prompt=none` from Postiz personal `LinkedinProvider.generateAuthUrl()` (checked-in `_postiz-v2.23.0/.../linkedin.provider.ts`). Keep scopes `openid profile w_member_social`, `state`, and `redirect_uri`.
2. ContOS `PostizClient.get_linkedin_authorization_url` strips any LinkedIn authorize `prompt` query param before returning the URL to Calendar (defense if VPS Postiz still emits `prompt=none`).
3. Calendar UX tells the user to switch or sign out of LinkedIn **in the OAuth popup** to connect a different account.

**Do not** call `POST /oauth/v2/revoke` — that endpoint is not documented in LinkedIn’s current 3-legged OAuth docs for this flow.

### Live verify after Postiz deploy

1. Deploy patched `linkedin.provider.ts` and restart Postiz backend.
2. Capture the live `authorization_url` from ContOS connect (or Postiz `/social/linkedin`).
3. Assert `prompt=none` absent and scopes correct.
4. Run real disconnect → reconnect before calling the fix complete.

Regression: ContOS `tests/test_postiz.py` asserts the checked-in provider source has no `prompt=none` and keeps the three scopes.

## Security notes

- Do not log or expose `pos_` tokens, LinkedIn access/refresh tokens, or client secrets.
- Prefer reducing scopes to what the app is approved for; do not request Marketing/Community Management products unless the LinkedIn app is approved for them.
- Do not invent undocumented OAuth `prompt` values (`login`, `select_account`) for LinkedIn.
