# Plan: logout + Google relogin flow fix (parallel-safe with link-password fix)

Spec: `docs/reasonix/specs/logout-relogin-flow-fix.md`
Audit: `docs/audits/2026-09-08-logout-relogin-flow-audit.md`
Sibling: `docs/reasonix/specs/link-password-modal-toast-fix.md` + `docs/reasonix/plans/link-password-modal-toast-fix-plan.md`
Status: Proposed
Branch: `fix/logout-relogin-flow` (create once from main; never touch main; no commit/push unless asked).

## 0. Parallel-execution rules (read before any edit)

1. No `backend/**` edits in this fix. Backend + `test_auth_contract.py` belong to the sibling.
2. No edits to `AppToasts.tsx`, link-password handlers/copy, or `toUserMessage` 404/5xx branches (sibling-owned).
3. Shared files (`frontend/src/lib/auth.ts`, `frontend/src/components/profile/sections.tsx`, `frontend/src/components/Pesdac.tsx`) use NON-OVERLAPPING hunks only: this fix owns logout/login/identity/hydration hunks listed per task. Do not reformat, move, or rename sibling-owned code.
4. New tests go in the NEW file `frontend/tests/auth-session-flow.test.ts` only. Do not touch sibling test files.
5. If a shared additive helper from the sibling is not yet merged, do not duplicate it: guard with existing APIs and log a follow-up in the task report.
6. Before final sign-off, rebase onto the sibling branch (whichever merges first) and re-run the full verification.

## Task list (in order)

### L1 — Reproduce and capture timing evidence (read-only unless instrumenting)

- Objective: record the literal strings and frame order for all three symptoms.
- Areas: `Pesdac.tsx:551-570,596-620`, `AuthGate.tsx`, `AuthLayout.tsx:221-269`, `auth.ts:240-279,558-585`, `OnboardingDialog.tsx:101-139`, `sections.tsx:172-193,271-284`.
- Steps:
  1. `git status --short` (leave foreign changes alone); confirm sibling branch is NOT merged into this working tree (note its absence in the report).
  2. Logout: authenticated on app route, devtools Network + console + Elements open. Click Logout. Record frame sequence (loader, every toast literal, every dialog open with timestamps), request log (`/auth/logout`, `/auth/me`, `/profiles/me`, `listAccounts`), and the landing URL.
  3. Google login: on `/login`, click Google. Record when spinner + `"Redirecting to Google…"` mount/unmount vs when navigation commits; record the Dimitri… (no — record the actual `handleGoogleSignIn` settle vs `window.location` change).
  4. Relogin profile: immediately after relogin open My Profile > Profile. Record whether `SkeletonCard`/`SkeletonIdentityHeader` mount, what campus/semester/branch render at 0ms / 1s / 5s, and the `/auth/me` + `/profiles/me` waterfall. Repeat open for comparison.
- Acceptance: verbatim toast/gate strings + ordered frame logs for F1-F3; waterfall timings; no code changed except temporary instrumentation (reverted before L2).
- Verification: pasted logs/screenshots in the task report.
- Rollback: n/a.

### L2 — Logout-intent window + guaranteed navigation (no backend change)

- Objective: loader -> `/login` with no gate flash and no transition-noise error surfaces.
- Files: `frontend/src/components/Pesdac.tsx` (`handleLogout`, `isLoggingOut`, gate/AuthRequired interplay), `frontend/src/components/auth/AuthGate.tsx` (transition-awareness only — no copy/layout change).
- Changes:
  1. Introduce a logout-intent window set at logout click and cleared when navigation to `/login` commits (bounded; navigation guaranteed even on backend/BetterAuth failure or hang — verify against the 15s `apiFetch` abort whether an extra timeout is needed).
  2. Gate reads the window and stays closed while it is active. Epoch-invalidated fetch rejections inside the window do not toast and do not open the onboarding error dialog; logout's own `server-failed`/catch toasts still fire.
  3. Reset `isLoggingOut` when navigation commits; reset `authExpiredRef` when its flow completes so later expiries still fire.
- Acceptance: AC1-AC2. Forced `/auth/logout` failure still toasts honestly and still lands on `/login`. No blanket error-toast suppression outside the window.
- Verification: `npm.cmd test`, `npm.cmd run astro -- check` from `frontend/` + browser frame log (zero gate frames, zero noise toasts).
- Rollback: revert the two files; logout returns to noisy-but-functional.
- Dependencies: L1. Parallel-safe: sibling does not touch these hunks.

### L3 — Google loader persistence + entry-point hygiene

- Objective: loader survives the redirect flight; no cross-identity cache leak on social login.
- Files: `frontend/src/components/auth/AuthLayout.tsx` (`handleGoogleSignIn` finally/error branches only), `frontend/src/lib/auth.ts` (`signInWithGoogle` + `signOut` hygiene lines only — no cache-shape change).
- Changes:
  1. Keep `isGoogleLoading(true)` on the success/redirect path; clear it only in the catch path (existing typed inline error stays). Email loader untouched.
  2. Add `clearAuthCache()` to `signInWithGoogle` (and to `signOut` if it sits on any login path), mirroring the email `signIn`/`signUp` T28 guard.
- Acceptance: AC3; relogin as a different identity never paints the previous identity's cached `/auth/me`/accounts.
- Verification: `npm.cmd test` (new cases in `auth-session-flow.test.ts`) + browser loader-persistence capture.
- Rollback: revert the two hunks.
- Dependencies: L1. Parallel-safe: sibling owns `linkPassword`/`refreshAccounts` hunks in the same file — do not touch them.

### L4 — Identity-keyed hydration + local seed clearing + skeleton coverage

- Objective: first profile open after any (re)login skeletons correctly and shows only the current identity.
- Files: `frontend/src/components/Pesdac.tsx` (hydration effect + `hydratedRef` only), `frontend/src/lib/session.ts` (additive seed-clear/retag helper only), `frontend/src/components/profile/sections.tsx` (`IdentitySection` skeleton condition + campus rows only — NOT the link-password areas), `frontend/src/lib/auth.ts` (logout-time seed clearing call site only).
- Changes:
  1. Key the server->local seed by identity (user id and/or auth epoch); reset the one-shot flag on logout and identity change; guard the write with the `identity-changed` pattern so a stale user-A resolve cannot seed user-B.
  2. Clear/retag the local profile seed on logout (new `session.ts` helper; call it from the logout path).
  3. Add an explicit seed-pending state consumed by `IdentitySection` so campus/semester/branch rows skeleton while the seed is in flight; keep ready-but-empty rendering identical to today; preserve offline fallback (defaults + remount retry).
- Acceptance: AC4-AC5. Stale-identity paint is impossible by construction (cleared + keyed + guarded).
- Verification: `npm.cmd test` (cross-identity + reseed cases) + browser first-open capture (skeleton at 0ms, correct values on land, no empty flash) + offline capture.
- Rollback: revert the four hunks; profile returns to empty-then-filled on first open.
- Dependencies: L1 (L2's window recommended before browser proof to avoid noise).

### L5 — Regression protection + full verification

- Objective: lock the behavior and prove both branches coexist.
- Files: NEW `frontend/tests/auth-session-flow.test.ts` only (+ docs notes if behavior changed).
- Tests (reuse existing `__setFetchForTesting` / fake-window patterns; no real network):
  - logout window suppresses gate + transition-noise errors but not logout's own failure toasts;
  - `isLoggingOut`/expiry refs reset;
  - Google loader persists on redirect path, clears on error;
  - social entry clears identity caches;
  - hydration reseeds on identity change and drops stale resolves;
  - seed-pending drives skeleton; ready-empty does not.
- Commands (exact):
  ```powershell
  # from frontend/
  npm.cmd test
  npm.cmd run astro -- check
  npm.cmd run build
  # from repo root/
  git diff --check
  ```
- Browser matrix: logout (ok + forced backend failure) × Google login (success flight + cancelled/failed) × profile first-open (same identity, different identity, offline) × desktop + <=640px; hard load + Astro transition; clean console; focus trap intact.
- Rebase check: fetch sibling branch, rebase, re-run all commands + the sibling's browser smoke (link-password toast above modal) to prove no hunk collision.
- Acceptance: AC1-AC7, per-task reports filed, no sibling-owned file reformatted.
- Rollback: delete/revert the new test file; source hunks roll back per L2-L4.

## Dependency order

```text
L1 (evidence)
 ├─ L2 (logout window) ─┐
 ├─ L3 (loader+hygiene) ─┤
 │                       ├─ L4 (hydration+skeleton) ── L5 (tests + rebase verify)
```

L2 and L3 are independent after L1 and may run in parallel with each other AND with the sibling's T2/T3. L4 needs L1 (and L2's window for clean browser proof). L5 needs all.

## File touch budget

Max five source files total outside tests: `Pesdac.tsx` (logout + hydration hunks), `AuthGate.tsx`, `AuthLayout.tsx`, `auth.ts` (entry hygiene + call site), `session.ts` (helper), `sections.tsx` (`IdentitySection` skeleton only). No theme, CSS, backend, or dependency changes.

## Risks

- Astro `transition:persist` island lifetime vs full document load on OAuth callback changes which refs survive; L1 must confirm the actual behavior on current versions before L4's keying is finalized.
- Over-suppressing errors inside the logout window would hide real failures; suppression is scoped to epoch-invalidated transition noise only, with logout's own outcomes untouched.
- The ~5s profile latency is measured, not fixed, here; if measurement shows token-mint retries or middleware timeouts dominating, file a follow-up instead of expanding scope.
