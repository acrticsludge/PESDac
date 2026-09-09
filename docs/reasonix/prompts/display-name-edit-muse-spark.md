# Muse Spark implementation prompt: editable display name (BetterAuth `updateUser`)

You are Muse Spark implementing in the PESDac repository. Work through the plan one task at a time on medium reasoning. Read these first, in order:

- `AGENTS.md`
- `docs/reasonix/specs/display-name-edit.md`
- `docs/reasonix/plans/display-name-edit-plan.md`
- `docs/slices/slice-14-password-form-feedback.md` (field-`status` + `onEnter` pattern source of truth)

Key source files (open them before editing):

- `frontend/src/components/profile/sections.tsx:174-195` (serverUser/authUser), `:323-366` (name + email rows)
- `frontend/src/lib/auth.ts:40-62` (T20 ownership comment), `:569-582` (`changePassword` wrapper style to mirror), `:676-790` (profile readers + `apiUpdateProfile`)
- `backend/app/deps.py` (upsert/mirror region — T1 read-only inspection target)
- `frontend/node_modules/better-auth/dist/api/routes/update-user.mjs:12-59` (endpoint semantics: name/image only, email rejected, session-gated, no verification)

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

Let signed-in users rename themselves from My Profile > Identity via `authClient.updateUser({ name })`, with slice-14-grade inline validation and zero backend changes (pending T1's mirror verdict). Email stays read-only. Start with T1. After each task, stop and report; continue only when that task's acceptance criteria are satisfied.

## Hard constraints

- Preserve the exported Astryx Playground UI exactly: Astryx 0.5.2, StyleX, `PESDacMockupTheme`, row layout, spacing, typography. Only the authed name control swaps Text -> TextInput+Save; email row, guest inputs, and everything else byte-identical.
- Do NOT touch the backend (no endpoint/schema/migration) unless T1 proves a creation-only mirror AND the human approves the FR2 fallback. Report, don't improvise.
- Do NOT send `email` (or anything but `name`) to `updateUser`; assert the body shape in tests.
- Do NOT add avatar/image editing, uniqueness checks, or moderation.
- 80-char cap mirrors the existing backend `[:80]` truncation; validate client-side with zero requests.
- Never log PII; test fixtures synthetic (`"Test User"` style).
- Work on a new branch `fix/display-name-edit` (create it once with `git checkout -b`). Never touch main. Do not commit, push, or reset files.
- Do not make a task larger than five touched files. Split it if necessary.
- Do not add test dependencies. node:test + existing seams only.

## Required working method

Work in task order T1-T3 from the plan. Before each edit: inspect the current implementation, make the smallest compatible change, run the focused checks, report. For every task use this report structure:

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

### T1 — evidence first

- Quote the upsert file:line proving per-request vs creation-only mirroring. If creation-only, STOP — do not design the fallback yourself; report the exact lines and wait.
- Unauthenticated `POST /api/auth/update-user {}` must NOT 404 (expect 401/400 — mounted proof). A 404 means a second fictional endpoint: stop and report.
- Confirm `authClient.updateUser` typechecks against the installed package (a scratch `astro check` on an unused import is enough; delete the scratch).
- No code changes in T1.

### T2 — wrapper

- Mirror the `changePassword` wrapper's shape (facade returns void, throws `Error` with server message or fallback). Trim first; empty/over-long throw before any client call.
- Mock `authClient.updateUser` at the seam the codebase already uses for BetterAuth client calls in tests (inspect before inventing). Assert: trim applied, zero calls on invalid, body is `{ name }` exactly, error passthrough, cache refresh on success.

### T3 — UI wiring

- Prefill with the current name; dirty-check suppresses no-op saves; busy disables input+button; `onEnter` submits.
- Field `status` for validation; toast for server/network via `toUserMessage(e, "Couldn't save your name. Try again.")`; 401 flows global untouched.
- Browser proof required (desktop + <=640px): rename persists across reload, validation costs zero requests (Network), hostile-name escaping (`<img src=x onerror=...>`-style input renders inert), guest regression, clean console.

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

Backend suite (`python -m pytest -q` from `backend/`) must pass with ZERO backend diffs — prove with `git status --short`. Paste exact failing command + error if anything fails; do not weaken tests or suppress warnings to pass.

## Acceptance checklist

- T1-T3 completed in order, or deviations explained.
- Mirror-cadence verdict recorded with file:line; no backend change made.
- Rename persists across reload; backend `/auth/me` agrees without manual refresh.
- Empty/over-long/unchanged inputs cost zero requests with correct inline errors.
- 401 mid-edit triggers the global flow exactly once; other failures toast recoverably with value preserved.
- Guest editing and email row byte-identical in behavior.
- Frontend tests, Astro check, build, `git diff --check` pass; backend suite green with no backend diffs.
- Astryx UI/theme/layout unchanged; no new dependencies.

## Final response format

Report:

1. mirror-cadence evidence and endpoint-mounted proof;
2. exact files changed and why;
3. validation/error-copy decisions;
4. tests and browser routes run with results;
5. unresolved risks and recommended follow-ups.
