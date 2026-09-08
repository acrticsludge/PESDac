# Muse Spark implementation prompt: logout + Google relogin flow fix (parallel-safe)

You are Muse Spark implementing in the PESDac repository. Work through the plan one task at a time on medium reasoning. Read these first, in order:

- `AGENTS.md`
- `docs/audits/2026-09-08-logout-relogin-flow-audit.md`
- `docs/reasonix/specs/logout-relogin-flow-fix.md`
- `docs/reasonix/plans/logout-relogin-flow-fix-plan.md`
- `docs/reasonix/specs/link-password-modal-toast-fix.md` (sibling — read for boundaries only, do not implement)
- `docs/reasonix/plans/link-password-modal-toast-fix-plan.md` (sibling — §0 ownership rules are binding)

Key source files (open them before editing):

- `frontend/src/components/Pesdac.tsx:518-570,596-620` (hydration effect, expiry handler, `handleLogout`)
- `frontend/src/lib/auth.ts:240-303` (`useAuth`, entry points), `:558-610` (`useProfile`, `apiGetProfile`), `:736-743,868-884` (`clearAuthCache`, `apiLogout`)
- `frontend/src/components/auth/AuthGate.tsx:30-40` (guest gate)
- `frontend/src/components/auth/AuthLayout.tsx:180-269,440-502` (Google loader + redirect text)
- `frontend/src/components/auth/OnboardingDialog.tsx:96-139,143-181` (onboarding check + error dialog)
- `frontend/src/components/profile/sections.tsx:172-193,271-284,340-426` (`IdentitySection` skeleton + campus rows only)
- `frontend/src/lib/session.ts:391-456` (local profile seed)
- `frontend/src/components/layout/InitialSession.astro`, `frontend/src/middleware/auth.ts`, `frontend/src/pages/login.astro`, `frontend/src/pages/new.astro`

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or the sibling fix. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

Fix the logout and Google relogin flows: clean loader-to-`/login` logout with no error toast and no gate flash; Google loader that survives the redirect flight; first profile open after relogin that skeletons (including campus rows) and never paints stale-identity or empty-then-filled state. Start with L1. After each task, stop and report; continue only when that task's acceptance criteria are satisfied.

## Hard constraints

- Preserve the exported Astryx Playground UI exactly: Astryx 0.5.2, StyleX, `PESDacMockupTheme`, layout, spacing, typography, colors, radii, behavior. No redesign, no custom toast/dialog, no Tailwind, no global CSS, no theme edit, no version change.
- No `backend/**` edits of any kind. Backend belongs to the sibling fix.
- Do not touch sibling-owned code: `AppToasts.tsx`, link-password handlers/state/copy in `sections.tsx`, `toUserMessage` 404/5xx branches.
- Shared files (`frontend/src/lib/auth.ts`, `frontend/src/components/profile/sections.tsx`, `frontend/src/components/Pesdac.tsx`) use NON-OVERLAPPING hunks only. Your hunks: logout/login/identity/hydration/skeleton. Never reformat, move, or rename sibling code.
- Never log secrets or tokens. Never suppress all error toasts — suppress only epoch-invalidated transition noise inside the logout window (L2); logout's own failure toasts stay.
- Work on a new branch `fix/logout-relogin-flow` (create once with `git checkout -b`). Never touch main or the sibling branch. Do not commit, push, or reset files.
- Do not make a task larger than five touched files. Split it if necessary.
- Do not guess at timing. Reproduce with frame logs and waterfalls first (L1).
- Do not change credentials, rotate secrets, alter the database schema, or change dependency versions without explicit human approval.

## Required working method

Work in task order L1-L5 from the plan. Before each edit: inspect the current implementation, reproduce, make the smallest compatible change, run focused checks, report. For every task use this report structure:

```text
Task: L_
Evidence observed:
Files inspected:
Files changed:
Acceptance criteria completed:
Commands/tests run:
Failures or warnings:
Sibling-conflict check:
Next action:
```

If blocked, do not improvise. Report the exact blocker and the smallest safe options. If a shared helper you need is sibling-owned and unmerged, do not duplicate it: use existing APIs and log the follow-up.

## Task-by-task guardrails

### L1 — reproduce first (no fix yet)

- Confirm the sibling branch is not in your tree; note it in the report.
- Logout capture: authenticated on an app route, devtools Network + console + Elements open. Record the verbatim toast string (candidates: `"Couldn't load linked accounts."` at `auth.ts:340`, `"Couldn't load your profile. Try again."` at `OnboardingDialog.tsx:130`, generic `AppToasts` copy), every gate-dialog open with timestamps, the request sequence, and the landing URL.
- Google capture: record spinner + `"Redirecting to Google…"` mount/unmount vs navigation commit. Note that `finally { setIsGoogleLoading(false) }` at `AuthLayout.tsx:266-268` runs during redirect flight.
- Profile capture: right after relogin, open My Profile and record skeleton mount vs empty campus paint at 0ms/1s/5s plus the `/auth/me` + `/profiles/me` waterfall. Repeat for the second open.
- Confirm whether the OAuth callback is a full document load (fresh `InitialSession`) or a persisted-island transition (stale `readInitialSession` cache, surviving `hydratedRef`). Your L4 keying depends on this.

### L2 — logout window

- Set the logout-intent window at click, clear it when navigation to `/login` commits; navigation is guaranteed (verify whether the 15s `apiFetch` abort suffices or a bounded timeout is needed).
- Gate reads the window and stays shut; epoch-killed fetches inside the window stay silent; `server-failed` and catch-path logout toasts still fire.
- Reset `isLoggingOut` on commit and the expiry ref on completion. Prove zero gate frames and zero noise toasts in the browser log, not just the end state.

### L3 — loader + hygiene

- `isGoogleLoading` clears only in the catch path; the redirect path keeps spinner + text until the browser leaves. Email loader untouched.
- Add `clearAuthCache()` to `signInWithGoogle` (mirror the T28 comment at `auth.ts:283-289`); touch only those hygiene lines, not the cache shape or `linkPassword`/`refreshAccounts` hunks.

### L4 — hydration + skeleton

- Re-key the `Pesdac.tsx:524-547` seed by identity (user id and/or epoch), reset the one-shot flag on logout/identity change, guard the write against stale resolves, and clear/retag the local seed on logout via a new additive `session.ts` helper.
- `IdentitySection` skeleton must cover seed-pending for campus/semester/branch (`sections.tsx:271-284,355-426`); ready-but-empty keeps today's `Select` placeholder rendering. Preserve offline fallback (defaults + remount retry).

### L5 — lock and verify coexistence

- New tests ONLY in `frontend/tests/auth-session-flow.test.ts` reusing the `__setFetchForTesting` / fake-window patterns: logout-window suppression scope, ref resets, loader persistence, social cache clear, identity-keyed reseed + stale-drop, seed-pending skeleton semantics.
- Then rebase onto the sibling branch (or main if it merged), re-run everything plus the sibling's link-password toast smoke to prove no hunk collision.

## Commands to run

From `frontend/`:

```powershell
npm.cmd test
npm.cmd run astro -- check
npm.cmd run build
```

From the repository root:

```powershell
git diff --check
```

Backend pytest belongs to the sibling; do not run it as acceptance for this fix (note it only if you suspect cross-branch breakage after a rebase).

Browser matrix (real browser, dev + production preview): logout ok, logout with forced `/auth/logout` failure, Google success flight, Google cancelled/failed, profile first-open after same-identity relogin, after different-identity relogin, and offline — each on desktop and <=640px, hard load and Astro transition, clean console, focus trap intact. Build-only is not acceptance. Paste exact failing command + error if anything fails; do not weaken tests or suppress warnings.

## Acceptance checklist

- L1-L5 completed in order, or deviations explained.
- Logout: loader -> `/login` with zero noise toasts and zero gate frames; forced backend failure still toasts honestly and still lands on `/login`; row never sticks on `"Logging out…"`.
- Google login: loader + text persist until navigation; failure clears loader with the existing typed inline error.
- First profile open after relogin skeletons identity + campus rows, paints only the current identity, no empty flash; repeat opens behave identically; offline degrades per spec.
- No cross-identity data leak (server caches + local seed).
- Astryx UI, theme, copy tone unchanged; no global CSS; no backend change; no dependency change.
- `npm.cmd test`, `astro check`, `build`, `git diff --check` pass; new tests in `auth-session-flow.test.ts` only; no sibling file reformatted; rebase + sibling smoke re-verified.

## Final response format

Report:

1. root causes for the logout flash, the early loader clear, and the missing first-open skeleton, with timing evidence;
2. exact hunks changed and why (per-file, noting sibling-boundary compliance);
3. tests and browser routes run with results;
4. rebase/coexistence result with the sibling branch;
5. unresolved risks and recommended follow-ups (including the ~5s profile latency measurement).
