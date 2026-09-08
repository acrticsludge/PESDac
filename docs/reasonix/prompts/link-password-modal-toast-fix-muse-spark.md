# Muse Spark implementation prompt: link-password 404 + toast behind My Profile modal

You are Muse Spark implementing in the PESDac repository. Work through the plan one task at a time on medium reasoning. Read these first, in order:

- `AGENTS.md`
- `docs/audits/2026-09-08-link-password-modal-toast-audit.md`
- `docs/reasonix/specs/link-password-modal-toast-fix.md`
- `docs/reasonix/plans/link-password-modal-toast-fix-plan.md`
- `docs/slices/slice-12b-link-credential.md`
- `docs/slices/slice-12e-error-toasts-everywhere.md`
- `docs/slices/slice-15-server-errors-to-toasts.md`

Key source files (open them before editing):

- `backend/app/routers/auth.py:60-135` (link-password route)
- `backend/app/main.py:130-131` (router mount at `/api/v1`)
- `backend/app/deps.py:64-103,118-164` (JWT auth + origin check)
- `backend/app/schemas/auth.py:21-22` (8-128 length rule)
- `frontend/src/lib/auth.ts:487-496` (`linkPassword`), `:659-670,745-831` (`apiFetch`), `:116-135` (`toUserMessage`), `:364-403` (`refreshAccounts`/`useAccounts`)
- `frontend/src/components/profile/sections.tsx:1370-1403` (`handleLinkPassword`), `:1170-1260` (section state), `:1489-1647` (Add/Change rows + link form)
- `frontend/src/components/profile/ProfileDialog.tsx:183-190` (Dialog)
- `frontend/src/components/Pesdac.tsx:1071,1653-1667` (LayerProvider + dialog host)
- `frontend/src/components/AppToasts.tsx` (toast host)

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

Fix the link-password feature in the My Profile modal: eliminate the reported `POST` 404 class, render error and success toasts sharp above the open dialog (not blurred behind it), and clear the trailing defects in the same flow (stale account list, upstream-401 logout, cookie scope, validation gaps). Start with T1. After each task, stop and report; continue only when that task's acceptance criteria are satisfied.

## Hard constraints

- Preserve the exported Astryx Playground UI exactly: Astryx 0.5.2, StyleX, `PESDacMockupTheme`, dialog width `min(1120px, calc(100vw - 2rem))`, `maxHeight 80dvh`, spacing, typography, colors, radii, behavior.
- Use existing Astryx components for toasts, dialogs, buttons, inputs. Do not recreate them, do not add Tailwind or another UI library, do not add global CSS, do not edit the theme, do not upgrade Astryx.
- Keep the contract path `POST {PUBLIC_API_BASE_URL}/api/v1/auth/link-password`. Do not add a second endpoint or rename the path.
- Never log or toast secrets, tokens, or passwords. Method + path + safe reason only in logs.
- Do not auto-retry the link mutation. Token-mint retry policy stays as-is.
- Work on a new branch `fix/link-password-modal-toast` (create it once with `git checkout -b`). Never touch main. Do not commit, push, or reset files.
- Do not make a task larger than five touched files. Split it if necessary.
- Do not guess at the 404 or the toast stacking. Reproduce and capture evidence first (T1).
- Do not change credentials, rotate secrets, alter the database schema, or change dependency versions without explicit human approval.

## Required working method

Work in task order T1-T6 from the plan. Before each edit: inspect the current implementation, reproduce the issue, make the smallest compatible change, run the focused checks, report. For every task use this report structure:

```text
Task: T_
Evidence observed:
Files inspected:
Files changed:
Acceptance criteria completed:
Commands/tests run:
Failures or warnings:
Next action:
```

If blocked, do not improvise. Report the exact blocker and the smallest safe options.

## Task-by-task guardrails

### T1 — reproduce first

- Run `python -m pytest tests/test_auth_contract.py -q` from `backend/`.
- Live probes: `GET http://localhost:8000/api/openapi.json` must contain `POST /api/v1/auth/link-password`; unauthenticated `POST http://localhost:8000/api/v1/auth/link-password` with `{}` must return 401 envelope, never 404. A 404 here proves a stale worker on port 8000 or wrong `PUBLIC_API_BASE_URL`, not a code bug. Check `Get-NetTCPConnection -LocalPort 8000` for a single listener started from `backend/`.
- Browser: with devtools open, submit the link form from the profile modal; record request URL, status, response body, console, and the Elements order of `div[popover="manual"]` (toast viewport, `showPopover` on mount) vs `dialog[open]` (profile dialog, `showModal` on open). Screenshot the toast vs modal stacking.
- Do not edit the route path based on a 404 until the stale-worker and env-drift causes are ruled out. `frontend/.env:9` host-only `PUBLIC_API_BASE_URL=http://localhost:8000` plus `API_PREFIX /api/v1` in `auth.ts:663` is the single join point.

### T2 — backend semantics

- Keep JWT -> origin -> rate-limit order. Map BetterAuth upstream failures to non-401 backend statuses (upstream 422 -> 422 `AUTH_VALIDATION`; other upstream failures -> `AUTH_ERROR`/`AUTH_UNREACHABLE`/`INTERNAL`, never 401) so `apiFetch` does not fire the global `pesdac:auth-required` logout for a cookie/upstream problem.
- Forward only the BetterAuth session cookie upstream, not the whole `Cookie` header. Shape-guard upstream JSON before reading `message`.
- Add tests: upstream-401-mapped-not-401, malformed upstream body fallback, session-cookie-only forwarding. Keep `test_link_password_route_is_registered` and all existing cases green.

### T3 — toast above modal

- Fix location is the toast host (`AppToasts.tsx` and/or `Pesdac.tsx` LayerProvider wiring), not the dialog styling. Preserve `toast={{ position: "topEnd", maxVisible: 3 }}` and `useToast()` call sites.
- Verify in a real browser with the dialog open (desktop + width <= 640px): forced error and success toasts are sharp, above the `::backdrop` blur, announced once. A clean build alone is not acceptance.

### T4 — stale account list

- `refreshAccounts()` alone does not refetch: `useAccounts()` in `auth.ts:376-403` only reacts to `auth.status`/`user.id`. Add an observable trigger it subscribes to (keep the identity-scoped `TaggedCache` guard). Wire `handleLinkGoogle` (currently no refresh, no toast), `handleUnlinkGoogle` (add success toast), and link success to it.
- Accounts `error` state must gain a retry control (currently both Add and Change rows vanish). Add the 128-char inline max check mirroring `LinkPasswordIn`.

### T5 — copy consistency

- Add an explicit `AuthServiceError` branch to `toUserMessage` (today it falls through the generic Error branch). Keep 404 as `"That didn't work. Please try again later."` and 5xx as `"That didn't work on our end. Please try again later."`. Do not reintroduce operator copy to users.

### T6 — lock and verify

- Add/keep backend tests (route, happy path, pre-upstream 422, 403, 429 + `Retry-After`, upstream mappings, cookie scope) and frontend boundary tests reusing the `__setFetchForTesting` router pattern in `frontend/tests/auth-api.test.ts` (AuthServiceError copy, validation short-circuit with zero fetches, refetch trigger, 401-still-dispatches vs mapped-401-does-not).

## Commands to run

From `backend/`:

```powershell
python -m pytest
python -m pytest tests/test_auth_contract.py -q
```

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

Also verify in a real browser (dev + production preview): My Profile > Authentication link flow, forced 422/429/502/offline toasts above the open modal, validation short-circuits in Network, accounts refetch without reload, narrow-viewport layout, clean console, screen-reader announcement. Paste exact failing command + error if anything fails; do not weaken tests or suppress warnings to pass.

## Acceptance checklist

- T1-T6 completed in order, or deviations explained.
- OpenAPI exposes `POST /api/v1/auth/link-password`; unauthenticated probe returns 401 envelope; no stale worker on :8000 during evidence.
- Authenticated valid link returns 200 `{ok:true}` and the Authentication rows update without reload.
- Short, mismatched, and >128-char passwords show the correct inline field error with zero requests.
- Forced server failures show a sharp toast above the open modal; modal stays open with values preserved.
- Upstream 401 during link toasts recoverably without navigating to `/login`; genuine backend 401 still triggers the session-expired flow exactly once.
- Accounts-error state offers retry; Google link/unlink show success toasts and refresh.
- Astryx UI, theme, dialog size, and behavior unchanged; no global CSS; no dependency change.
- Backend tests, frontend tests, Astro check, build, and `git diff --check` pass with per-task reports.

## Final response format

Report:

1. root cause for the 404 and for the behind-modal toast, with evidence;
2. exact files changed and why;
3. Better Auth findings and any env/deployment notes (no secret values);
4. tests and browser routes run with results;
5. unresolved risks and recommended follow-ups.
