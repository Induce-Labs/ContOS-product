# Final LinkedIn QA — Automated Regression Pass

**Date:** 2026-09-24  
**Scope:** Existing ContOS Postiz/LinkedIn automated suites only. No media-contract change. No live LinkedIn publish invented.  
**Media contract (unchanged):** 0–10 images **XOR** exactly 1 MP4.

## Test isolation

| Check | Result |
|-------|--------|
| Backend `test_postiz.py` / `test_phase6_hardening.py` | Uses `unittest.mock` / MagicMock; Fernet test keys; no live Postiz HTTP, LinkedIn OAuth, or production credentials required |
| Frontend `postizMedia.test.ts` | Pure unit tests; no network |
| Missing env / live Postiz | Would be classified **ENV** / **MANUAL** — not a reason to change production code |

## Commands run

```powershell
# Backend
cd Backend
.\.venv\Scripts\python.exe -m pytest tests/test_postiz.py tests/test_phase6_hardening.py -q --tb=short
# → 83 passed (before exactly-10 test); 84 passed after adding test_accepts_exactly_ten_images

# Frontend
cd Frontend
npm test          # → 18 passed (postizMedia.test.ts)
npm run lint      # → exit 1 (20 errors, 7 warnings — none in Calendar/Postiz LinkedIn paths)
npx tsc -b --pretty false  # → exit 0
```

## QA matrix

| Test | Result | Evidence |
|------|--------|----------|
| Avatar isolation | **PASS** | `TestPostizCalendarPosts` ABC isolation; cross-avatar update/delete rejected; OAuth status isolation |
| Authentication | **PASS** | `TestPostizRoutesAuth` / posts routes 401; unowned avatar 404; no `pos_` in status responses |
| Connection flow (mocked) | **PASS** | Service connect/status/claim/disconnect with mocked Postiz client |
| Connection flow (live OAuth) | **MANUAL** | Real LinkedIn OAuth popup + claim not exercised in CI |
| Post lifecycle (partial) | **PARTIAL** | Schedule create, draft+image, cross-avatar fail covered; full draft→edit→schedule→delete browser happy path not automated |
| 1 / multi images | **PASS** | `test_single_and_multiple_ordered_images` (1 + 3 ordered) |
| Exactly 10 images accept | **PASS** | `TestPostizMediaPosts::test_accepts_exactly_ten_images` (added this pass; was gap) |
| Reject 11 images | **PASS** | `test_rejects_more_than_ten_images` |
| Media edit / reorder / clear | **PASS** | `test_edit_add_remove_reorder_and_remove_all` |
| 1 MP4 | **PASS** | `test_upload_accepts_mp4_video`, `test_single_video_post_uses_image_array` |
| Image+video / 2+ video reject | **PASS** | Backend `test_rejects_two_videos_and_image_video_mix`; frontend `postizMedia.test.ts` |
| Frontend media UX helpers | **PASS** | `npm test` — 18 tests in `src/lib/postizMedia.test.ts` |
| Calendar UI regression | **MANUAL** | No `CalendarPage` component tests; backend switch isolation covered separately |
| Upload failure (API) | **PASS** | `test_upload_failure_does_not_create_post` |
| Upload UI states (uploading/error/retry) | **MANUAL** | Calendar UI not covered by unit tests |
| TypeScript build | **PASS** | `npx tsc -b --pretty false` exit 0 |
| ESLint (repo-wide) | **PARTIAL** | Failures in Agents/Theme/Profiling/LanguageSelector etc.; **none** in Calendar/Postiz LinkedIn files — treated as pre-existing, out of LinkedIn QA fix scope |
| Live LinkedIn publish | **MANUAL** | Out of automated phase; not claimed |

## Automated QA Summary

- ContOS Postiz/LinkedIn **service and route** paths covered by mocks: **PASS** (backend 84 tests across Postiz + phase6 hardening after boundary add; frontend media 18/18).
- Media contract XOR rules: **PASS** (backend + frontend).
- Exactly-10 upper bound: **PASS** after one minimal mocked unit test.
- Live OAuth, Calendar UI, and real LinkedIn publish: **not** validated by automation.

## Manual Tests Still Required

1. **OAuth / connect:** From Calendar, connect LinkedIn for avatar A; confirm status `connected`; disconnect; reconnect. Switch project/avatar and confirm posts/status do not leak across avatars.
2. **Calendar UI media:** Attach 1 image, 3 images, exactly 10 images; attach 1 MP4; confirm UI blocks image+video and 2+ videos; confirm uploading / error / retry messaging.
3. **Post lifecycle in UI:** Draft → edit media → schedule → delete (or status change) for one avatar.
4. **Real LinkedIn publish (optional):** Only with a real connected LinkedIn integration — verify a scheduled/`now` post appears on LinkedIn. Do **not** treat this as automated.

## Bugs Found

| Item | Classification |
|------|----------------|
| No ContOS Postiz/LinkedIn production bug from failing suites | — |
| Repo-wide `npm run lint` errors (Agents, Theme, Profiling, …) | Pre-existing / **out of scope** for this LinkedIn QA pass — not fixed |
| Env / live Postiz unavailable | N/A — suites did not require them |

## Code Changes Made

| Change | Why |
|--------|-----|
| Added `TestPostizMediaPosts::test_accepts_exactly_ten_images` in [`Backend/tests/test_postiz.py`](../Backend/tests/test_postiz.py) | Phase B: no accept-exactly-10 coverage after Phase A |
| Production ContOS / Postiz / media contract | **Unchanged** |

## Final LinkedIn Readiness

**Ready for automated ContOS path** (auth, avatar isolation, media XOR contract, mocked Postiz posts/upload).

**LinkedIn OAuth and real publish are not fully validated** until the MANUAL steps above are completed. Do not declare “LinkedIn fully validated” from this report alone.

See also: [`Docs/phase-postiz-linkedin.md`](phase-postiz-linkedin.md) for architecture and media contract.
