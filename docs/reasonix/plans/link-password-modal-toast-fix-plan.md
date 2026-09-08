# Plan: link-password in My Profile + toast-over-modal fix

Spec: `docs/reasonix/specs/link-password-modal-toast-fix.md`
Audit: `docs/audits/2026-09-08-link-password-modal-toast-audit.md`
Status: Proposed
Branch rule: create `fix/link-password-modal-toast` from main; never commit to main; do not push/commit unless the user explicitly asks.

## Task list (vertical slices, in order)

### T1 — Reproduce and capture evidence (no code changes unless needed to instrument)

- Objective: prove whether the 404 and the behind-modal toast reproduce on current code, and capture the exact artifacts.
- Areas: `backend/app/routers/auth.py`, `backend/app/main.py`, `frontend/src/lib/auth.ts`, `frontend/src/components/profile/sections.tsx`, live workers on :8000/:4321.
- Steps:
  1. `git status --short` (do not touch unrelated modifications).
  2. `python -m pytest backend/tests/test_auth_contract.py -q` (from `backend/`).
  3. Live probes: `GET http://localhost:8000/api/openapi.json` (assert `POST /api/v1/auth/link-password` present); unauthenticated `POST /api/v1/auth/link-password {}` -> expect 401 envelope, fail if 404; `Get-NetTCPConnection -LocalPort 8000` to prove a single current worker started from `backend/`.
  4. Browser: open My Profile > Authentication > Add, submit a valid link with devtools Network + Elements open; capture request URL/status/body, toast viewport element (`div[popover="manual"]`) vs `dialog[open]` order, `::backdrop` blur, console errors, and a screenshot showing toast vs modal stacking.
- Acceptance: written evidence for 404 (stale worker vs real regression) + toast stacking (top-layer order capture); `AC1` probe results recorded.
- Verification: pytest output + probe outputs + screenshot/devtools notes pasted in the task report.
- Rollback: n/a (read-only).

### T2 — Backend error-semantics hardening (no path change)

- Objective: make upstream failures recoverable and stop leaking backend 401s.
- Files: `backend/app/routers/auth.py`, `backend/tests/test_auth_contract.py`.
- Changes:
  1. Map upstream non-success to non-401 backend statuses (upstream 422 -> 422 `AUTH_VALIDATION`; upstream 401/400/409/5xx -> their semantics under `AUTH_ERROR`, never 401; keep 502 `AUTH_UNREACHABLE` and 500 `INTERNAL` paths).
  2. Forward only the BetterAuth session cookie upstream (parse `Cookie`, forward the session key, drop the rest).
  3. Shape-guard upstream JSON (`isinstance dict` + `message is str`) before use; fallback to safe default copy.
- Acceptance: new tests pass for upstream-401-mapped-not-401, malformed-body fallback, session-cookie-only forwarding; existing happy/422/403/429/502 tests still pass.
- Verification: `python -m pytest -q` from `backend/`.
- Rollback: revert `auth.py` + test file; contract path unchanged so frontend is unaffected.
- Dependencies: T1.

### T3 — Toast-above-modal fix (Astryx-preserving)

- Objective: toasts from the profile flow paint sharp above the open dialog.
- Files: `frontend/src/components/Pesdac.tsx` and/or `frontend/src/components/AppToasts.tsx` (preferred); do NOT edit `PESDacMockupTheme`, global CSS, or `node_modules`.
- Constraints: keep `LayerProvider toast={{position:"topEnd",maxVisible:3}}`, keep `useToast()` call sites, keep Astryx 0.5.2 APIs; no custom toast/dialog, no global `z-index` override.
- Approach (verify live before committing to one):
  1. Capture devtools proof that `showModal()` (dialog open) postdates `showPopover()` (viewport mount).
  2. Implement the smallest re-promotion: re-assert the existing toast viewport's top-layer recency when a dialog opens and/or when a toast is enqueued (public DOM APIs on the existing viewport element only).
  3. Fallback if re-promotion is flaky: scope the fix to dispatch ordering (ensure toast fires after dialog paint) — still no visual restyle.
- Acceptance: with `ProfileDialog` open, forced error + success toasts are sharp, fully above backdrop, at topEnd, announced once; dialog size/behavior unchanged; no console errors.
- Verification: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build` from `frontend/` + real-browser desktop and <=640px captures.
- Rollback: revert the toast-host change; toasts return to behind-modal (degraded but functional).
- Dependencies: T1.

### T4 — Stale linked-account state (refetch, not just cache-clear)

- Objective: link/unlink/Google-link visibly update without reload.
- Files: `frontend/src/lib/auth.ts` (`refreshAccounts`, `useAccounts`, `apiGetAccounts`), `frontend/src/components/profile/sections.tsx` (`handleLinkGoogle`, `handleUnlinkGoogle`, `handleLinkPassword`, accounts-error branch).
- Changes:
  1. Give `refreshAccounts()` an observable trigger (`useAccounts` subscribes; identity-scoped, preserves `TaggedCache` user-id guard and `identity-changed` semantics).
  2. `handleLinkGoogle`: refresh + success toast; `handleUnlinkGoogle`: success toast + visible refresh; `handleLinkPassword` success already toasts — wire it to the same refetch.
  3. Accounts `error` state: add a retry control that re-invokes the fetch; keep row copy as supplement.
  4. Add frontend max-length (128) inline check on the link form.
- Acceptance: AC3-AC5 flows update rows without reload; accounts-error shows retry; over-long password is inline with zero requests.
- Verification: `npm.cmd test` (new boundary tests for refetch + `AuthServiceError` copy) + browser Network proof (no request on validation failures, one refetch on success).
- Rollback: revert `auth.ts`/`sections.tsx`; worst case returns to reload-to-see behavior.
- Dependencies: T1 (T2 for error-copy assertions).

### T5 — Frontend error-copy + success-toast consistency

- Objective: pin the user-safe copy and toast types.
- Files: `frontend/src/lib/auth.ts` (`toUserMessage` explicit `AuthServiceError` branch), `frontend/src/components/profile/sections.tsx` (confirm `type:"error"` for failures, confirm success type per installed Astryx Toast API without redesigning).
- Acceptance: 404/5xx/offline/rate-limit/origin-denied each show the spec copy; `AuthServiceError` branch covered by test.
- Verification: `npm.cmd test` + manual toast matrix in browser.
- Rollback: revert copy branches only.
- Dependencies: T2, T4.

### T6 — Regression protection + full verification

- Objective: lock the fix and prove no regressions.
- Files: `backend/tests/test_auth_contract.py`, `frontend/tests/auth-api.test.ts` (or new `link-password` test file reusing `__setFetchForTesting` router pattern), docs updates if behavior changed.
- Tests to add/keep:
  - Backend: route-registered, happy path, length validation pre-upstream, origin 403, rate-limit 429 + `Retry-After`, upstream-422 mapping, upstream-401-not-ours, malformed upstream body, unreachable 502, cookie-forwarding scope.
  - Frontend: `AuthServiceError` copy branch, link success refetch trigger, validation short-circuits (no fetch), 401-still-dispatches vs upstream-mapped-401-does-not.
- Commands (exact):
  ```powershell
  # from backend/
  python -m pytest
  # from frontend/
  npm.cmd test
  npm.cmd run astro -- check
  npm.cmd run build
  # from repo root/
  git diff --check
  ```
- Browser matrix: guest/authenticated/expired/slow/offline × desktop/narrow; hard load + Astro transition; clean console; toast announced; dialog focus trap intact.
- Acceptance: all commands green, AC1-AC7 checked, task reports filed.
- Rollback: revert test files independently; no production data involved.

## Dependency order

```text
T1 (evidence)
 ├─ T2 (backend semantics) ─┐
 └─ T3 (toast layering) ─────┤
                             ├─ T4 (refetch) ── T5 (copy) ── T6 (tests + verify)
```

T2 and T3 are independent after T1 and may run in parallel; T4 needs T1 (and T2's error codes for assertions); T5 needs T2+T4; T6 needs all.

## File touch budget

- Max five touched source files per task; split further if a task exceeds that. Expected total: `backend/app/routers/auth.py`, `backend/tests/test_auth_contract.py`, `frontend/src/lib/auth.ts`, `frontend/src/components/profile/sections.tsx`, `frontend/src/components/AppToasts.tsx` and/or `frontend/src/components/Pesdac.tsx`, plus one frontend test file. No theme, CSS, or dependency changes.

## Risks

- Top-layer re-promotion may behave differently across Chromium/Firefox/Safari; if the chosen mechanism is browser-specific, fall back to the narrowest Astryx-supported ordering and document the limitation instead of inventing a custom layer.
- `set-password` semantics when a credential already exists must be confirmed against BetterAuth 1.7.3 source/docs during T2; if it updates rather than errors, the double-link edge becomes idempotent and T4's refetch covers it.
- Single listener on :8000 must be enforced during every live probe; a second stale worker invalidates all browser evidence.
