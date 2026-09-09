# Plan: editable display name in My Profile

Spec: `docs/reasonix/specs/display-name-edit.md`
Status: Proposed
Branch rule: create `fix/display-name-edit` from main; never commit to main; do not push/commit unless the user explicitly asks.

## Task list (vertical slices, in order)

### T1 — Evidence: mirror cadence + endpoint reality (read-only)

- Objective: confirm the mechanism needs zero backend work and the endpoint path is live.
- Areas: `backend/app/deps.py` (upsert/mirror region), `frontend/src/lib/auth.ts:47-62,771-780`, live BetterAuth on :4321.
- Steps:
  1. `git status --short` (do not touch unrelated modifications).
  2. Read the `get_current_user` upsert: does `users.display_name` re-mirror BetterAuth `name` per request or only at row creation? Record file:line + verdict (per-request -> no backend work; creation-only -> STOP and report FR2 fallback for approval).
  3. Live probe (single listener on :4321): unauthenticated `POST /api/auth/update-user {}` -> expect 401/400 (path mounted), fail loudly on 404 (second fictional endpoint). Record status + body shape.
  4. Confirm `authClient.updateUser` exists on the installed client's type surface (path-derived proxy implies it; verify, don't assume).
- Acceptance: written mirror-cadence verdict; endpoint-mounted proof; no code changed.
- Verification: probe outputs pasted in the task report.
- Rollback: n/a (read-only).

### T2 — Facade wrapper + unit tests

- Objective: `updateDisplayName(name)` per spec §6 FR1 with zero-network validation.
- Files: `frontend/src/lib/auth.ts` (append near `changePassword`), `frontend/tests/display-name.test.ts` (new; mock `authClient.updateUser` — check how existing tests mock `authClient` methods, or inject via the `__setFetchForTesting`-style seam if one fits; do NOT add a test framework).
- Changes:
  1. Trim; empty -> throw user-safe `Error("Enter a display name.")` before any call.
  2. `> 80` chars -> throw user-safe length `Error` before any call.
  3. Else `authClient.updateUser({ name: trimmed })`; on `res.error` throw `Error(res.error.message ?? fallback)`; on success refresh profile caches via the existing post-save path.
  4. Tests: trim/empty/long/unchanged-needs-no-call (unchanged check lives in UI; wrapper tests cover trim+validate+shape), assert outgoing body has `name` and NO `email` key, error-message passthrough, cache refresh on success.
- Acceptance: AC-relevant unit asserts green; no other facade behavior changed.
- Verification: `npm.cmd test` from `frontend/`.
- Rollback: revert the two files; nothing else references the wrapper yet.
- Dependencies: T1 (mirror verdict gates whether a backend fallback task is needed — it is NOT in this plan; report first).

### T3 — IdentitySection wiring (Astryx-preserving)

- Objective: authed Display-name row becomes editable per spec §6 FR3; email row untouched.
- Files: `frontend/src/components/profile/sections.tsx` (`IdentitySection` name row only).
- Changes:
  1. When `authUser != null`: `TextInput` prefilled with current name + Save affordance + `onEnter` submit; busy/disable states mirroring `isSavingIdentity` conventions; dirty-check (no request when unchanged).
  2. Validation errors -> field `status`; server/network -> `toUserMessage(e, "Couldn't save your name. Try again.")` toast; value preserved; busy clears.
  3. 401 -> untouched global flow (no local handling).
- Acceptance: AC1-AC4 flows; guest inputs byte-identical; email row byte-identical.
- Verification: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build` + browser matrix (desktop/narrow, reload persistence, clean console, escaping check for `<script>`-looking names).
- Rollback: revert `sections.tsx`; wrapper stays (unused) or goes with it.
- Dependencies: T2.

## Dependency order

```text
T1 (evidence: mirror cadence, endpoint mounted)
 └─ T2 (wrapper + tests)
     └─ T3 (UI wiring + browser matrix)
```

Strictly serial; T2 needs T1's mirror verdict (a creation-only mirror would force a spec detour, not silent backend work).

## File touch budget

- Max five touched source files total (expected three): `frontend/src/lib/auth.ts`, `frontend/src/components/profile/sections.tsx`, `frontend/tests/display-name.test.ts` (new). No backend, theme, CSS, dependency, or route changes. Exceeding this means the task was mis-scoped — split and report.

## Risks

- Backend mirror is creation-only: then `/auth/me` goes stale after rename until next login — the plan STOPS for approval rather than sneaking in a backend change.
- `authClient.updateUser` type/proxy drift in 1.7.3: T1 verifies against the installed package, not memory or docs.
- Name rendering/XSS: Astryx `Text` is expected to escape; T3 proves it with a hostile-name browser check rather than asserting it.
- Scope creep into avatar `image` editing or email change: explicitly out; both need upload/moderation/verification stories that don't exist.
