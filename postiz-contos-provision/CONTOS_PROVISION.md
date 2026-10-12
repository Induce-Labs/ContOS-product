# ContOS → Postiz Approach B provisioning (v2.23.0 patch)

## Subscription verification (completed before coding)

Against Postiz `v2.23.0` source:

| ContOS need | Gate | Org without `Subscription` |
|---|---|---|
| `GET /public/v1/integrations` | `PublicAuthMiddleware` only | **Works** if `STRIPE_SECRET_KEY` unset (middleware skips subscription check). No `@CheckPolicies`. |
| `GET /public/v1/social/linkedin` | `@CheckPolicies(CHANNEL)` | **Works** if `STRIPE_PUBLISHABLE_KEY` unset — `PermissionsService.check` grants all requested permissions unconditionally. |
| `POST /public/v1/posts` | `@CheckPolicies(POSTS_PER_MONTH)` | **Same** — granted when Stripe publishable key unset. |

**Precondition for this patch:** Postiz self-host must **not** set `STRIPE_SECRET_KEY` (provision refuses with 503 if set). Provisioning creates **no** Subscription and never uses `createMaxUser` / ULTIMATE.

## Endpoints (ContOS FastAPI only)

```http
POST /api/internal/contos/provision-avatar
Authorization: Bearer <CONTOS_PROVISION_SECRET>
{ "avatar_id": "<uuid>" }

POST /api/internal/contos/rotate-avatar-token
Authorization: Bearer <CONTOS_PROVISION_SECRET>
{ "avatar_id": "<uuid>" }
```

Response:

```json
{ "organization_id": "...", "created": true|false, "access_token": "pos_..." }
```

- Provision **reuses** an existing valid `pos_` (decrypt). It does **not** rotate.
- Missing/revoked token on provision → **409** — call `rotate-avatar-token`.
- Browser / Public API / SuperAdmin / `pos_` auth cannot call these routes.

## Env

```bash
CONTOS_PROVISION_SECRET=<high-entropy>
CONTOS_OAUTH_CLIENT_ID=pca_...   # existing ContOS OAuth App only
CONTOS_PROVISION_IP_ALLOWLIST=   # optional comma-separated ContOS egress IPs
# Do not set STRIPE_SECRET_KEY for ContOS-provisioned orgs
```

## Apply on VPS

1. Copy patched files onto the Postiz `v2.23.0` tree (this checkout or your deploy).
2. From Postiz root:

```bash
pnpm prisma-generate
# preferred for self-host schema sync:
pnpm prisma-db-push
# OR apply SQL:
# psql "$DATABASE_URL" -f libraries/nestjs-libraries/src/database/prisma/migrations/contos_avatar_organization.sql
```

3. Rebuild/restart backend.
4. Tests:

```bash
pnpm exec jest apps/backend/src/services/contos/contos-provision.service.spec.ts --coverage=false
```

## Files changed / added

See `FILES.md` in this directory twin under ContOS `Docs/postiz-contos-provision.md`.
