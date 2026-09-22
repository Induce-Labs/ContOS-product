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

SSH is required (agent environment has no VPS private key). From a machine that can `ssh -p 7576 root@103.135.230.110`:

```bash
# Copy the patched linkedin.provider.ts into the Postiz tree on the VPS, then rebuild/restart the Postiz backend container (exact compose service name may vary).
scp -P 7576 \
  libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts \
  root@103.135.230.110:/path/to/postiz/libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts

ssh -p 7576 root@103.135.230.110 'cd /path/to/postiz && docker compose build backend && docker compose up -d backend'
```

Local patched file (already applied in ContOS checkout):

`_postiz-v2.23.0/libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts`

## Verify

1. Call `GET /api/public/v1/social/linkedin` with a ContOS-provisioned `pos_` token.
2. Confirm auth URL `scope=` is only `openid profile w_member_social`.
3. Opening that URL must **not** show LinkedIn “Bummer”; it should show Sign in / Allow.
4. After Allow, Postiz callback adds the channel; ContOS `GET /api/postiz/status?avatar_id=` becomes `connected: true`.

## Security notes

- Do not log or expose `pos_` tokens, LinkedIn access/refresh tokens, or client secrets.
- Prefer reducing scopes to what the app is approved for; do not request Marketing/Community Management products unless the LinkedIn app is approved for them.
