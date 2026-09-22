# Same-user multi-avatar Postiz LinkedIn reuse — root cause

## Root cause

**Frontend avatar selection**, not ContOS provisioning / Postiz org selection.

Exact location:

1. `Frontend/src/pages/CalendarPage.tsx` — previously  
   `avatarId = activeProject?.id ?? projectId`  
   Preferring stale `activeProject` over the URL meant status/connect/claim for **Avatar A** while the user was on `/dashboard/{AvatarB}/calendar`.

2. `Frontend/src/hooks/useDashboardShell.ts` — when `projectId` was missing from the loaded list, it called `setActiveProject(resolveActiveProject(...))`, substituting **Avatar A (default)** while the URL still pointed at Avatar B.

Evidence:

- Backend `get_connection` / provision / Redis keys are already `avatar_id`-scoped.
- Same ContOS user Avatar B (`04883eca…`) had **no** `postiz_connections` row while Avatar A showed connected — Calendar was displaying A’s status on B’s route.
- Backend logs never showed `connect`/`status` for `04883eca…` during the “B reused A” reports; only Avatar A’s id appeared.

Category: **frontend avatar state** (not DB lookup, provisioning, OAuth state, Redis, or claim).

## Path comparison (intended / after fix)

| Step | Avatar A | Avatar B |
| --- | --- | --- |
| URL | `/dashboard/A/calendar` | `/dashboard/B/calendar` |
| `avatarId` | `A` from `projectId` | `B` from `projectId` (wait if `activeProject` mismatches) |
| `GET /api/postiz/connect?avatar_id=` | A | B |
| `get_connection(avatar_id)` | row A | row B (or provision) |
| `provision-avatar` | Org A + token A | Org B + token B |
| Redis snapshot | `postiz:linkedin:snapshot:A` | `postiz:linkedin:snapshot:B` |
| LinkedIn URL | Org A’s `pos_` | Org B’s `pos_` |
| Status / claim | A only | B only |

## Fix (minimal)

- Prefer URL `projectId`; if `activeProject` disagrees, treat as loading (`avatarId = null`).
- Sync `activeProject` from in-memory projects on URL change; never substitute another avatar on miss.
- Clear Calendar LinkedIn UI immediately on avatar switch.
- Safe backend logs: `avatar_id`, `postiz_organization_id`, `postiz_integration_id` (no tokens/secrets).

No migration required.
