# Postiz ContOS Approach B provisioning (implemented on Postiz side)

## Purpose

Provision one Postiz Organization + dedicated LOCAL owner + org-scoped `pos_` per ContOS avatar, via a tightly locked internal machine API (Approach B). ContOS Backend consumes these endpoints from `PostizClient.provision_avatar` / `rotate_avatar_token` (server-to-server only).

## Subscription verification (v2.23.0)

Without `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY`, ContOS Public API needs work with **no** `Subscription` row:

- `GET /integrations` — auth only
- `GET /social/linkedin` — policies short-circuit allow-all when Stripe publishable key unset
- `POST /posts` — same

Provision **refuses** if `STRIPE_SECRET_KEY` is set (503). Never uses `createMaxUser` / ULTIMATE.

## API

| Method | Path | Auth |
|---|---|---|
| POST | `/api/internal/contos/provision-avatar` | `Authorization: Bearer CONTOS_PROVISION_SECRET` |
| POST | `/api/internal/contos/rotate-avatar-token` | same |

Body (both): `{ "avatar_id": "<uuid>" }` only (`forbidNonWhitelisted`).

Response: `{ "organization_id", "created", "access_token" }`.

Token policy: provision **reuses** valid token; missing/revoked/unrecoverable → 409 with rotate instruction. ContOS rotates **only** on those specific 409 bodies; other 409s propagate.

## Postiz files (in `_postiz-v2.23.0` checkout / VPS tree)

**Added**

- `libraries/nestjs-libraries/src/dtos/contos/provision-avatar.dto.ts`
- `libraries/nestjs-libraries/src/database/prisma/contos/contos-avatar.repository.ts`
- `libraries/nestjs-libraries/src/database/prisma/migrations/contos_avatar_organization.sql`
- `apps/backend/src/services/contos/contos-provision.service.ts`
- `apps/backend/src/services/contos/contos-provision.guard.ts`
- `apps/backend/src/services/contos/contos-token-safety.ts`
- `apps/backend/src/services/contos/contos-provision.service.spec.ts`
- `apps/backend/src/api/routes/contos-internal.controller.ts`
- `CONTOS_PROVISION.md`

**Modified**

- `libraries/nestjs-libraries/src/database/prisma/schema.prisma` — `ContosAvatarOrganization` + relations
- `libraries/nestjs-libraries/src/database/prisma/database.module.ts` — register repository
- `libraries/nestjs-libraries/src/database/prisma/oauth/oauth.repository.ts` — mint helpers
- `apps/backend/src/api/api.module.ts` — controller + providers (**not** under `AuthMiddleware`)
- `libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts` — personal LinkedIn scopes limited to `openid profile w_member_social` (see [postiz-linkedin-oauth-scopes-fix.md](./postiz-linkedin-oauth-scopes-fix.md))

## Migration command

From Postiz root after deploying schema changes:

```bash
pnpm prisma-generate
pnpm prisma-db-push
```

Or SQL-only:

```bash
psql "$DATABASE_URL" -f libraries/nestjs-libraries/src/database/prisma/migrations/contos_avatar_organization.sql
```

## Env (Postiz)

```
CONTOS_PROVISION_SECRET=...
CONTOS_OAUTH_CLIENT_ID=pca_...
CONTOS_PROVISION_IP_ALLOWLIST=   # optional
```

## Security

- Shared secret + optional IP allowlist
- No browser / SuperAdmin / Public API exposure
- `pos_` redacted in ContOS provision error logs via `sanitizeErrorForLog`
- Do not enable Nest HTTP body logging of this route

## Tests

```bash
cd _postiz-v2.23.0
pnpm exec jest apps/backend/src/services/contos/contos-provision.service.spec.ts --coverage=false
```

Covers: create, idempotent reuse, no auto-rotate on provision, explicit rotate, Avatar A/B isolation, Stripe guard.

## Known limitations

- ContOS Backend consumes provision/rotate via `PostizClient` (avatar-scoped Calendar connect).
- Requires Postiz without Stripe secret for org-without-subscription Public API.
- Full clone `_postiz-v2.23.0` is a local worktree; deploy by copying patched files onto the VPS Postiz image/source.
