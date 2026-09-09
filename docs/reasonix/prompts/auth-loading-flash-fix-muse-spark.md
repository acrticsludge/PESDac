# Muse Spark implementation prompt: loading flashes (gate on refresh, profile error after login)

You are Muse Spark implementing in the PESDac repository. Work through the plan one task at a time on medium reasoning. Read these first, in order:

- `AGENTS.md`
- `docs/reasonix/specs/auth-loading-flash-fix.md`
- `docs/reasonix/plans/auth-loading-flash-fix-plan.md`
- `docs/slices/slice-11-popup-latency.md` (Step 1 note — you are narrowing its fast path, not reverting it)

Key source files (open them before editing):

- `frontend/src/middleware/auth.ts:1-31` (800ms race + null-fallback — S1 root cause)
- `frontend/src/components/layout/InitialSession.astro` (tag contract comment + serializer)
- `frontend/src/lib/auth.ts:197-330` (tag type/reader/resolver/pending branch)
- `frontend/src/components/auth/AuthGate.tsx:36-58` (guest -> dialog; read-only)
- `frontend/src/components/auth/OnboardingDialog.tsx:100-195` (single-attempt effect + error dialog — S2 root cause)
- `frontend/tests/initial-session.test.ts` (existing six cells MUST pass unmodified)

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

Kill two flashes without weakening the instant paths: (1) gate opening on refresh-while-authed when the middleware gave up (not proved guest) — fix with an explicit unknown tag state failing closed to `loading`; (2) profile-error dialog on a single transient onboarding-check failure — fix with bounded silent retries, dialog only on exhaustion. Start with T1 (read-only). After each task, stop and report; continue only when that task's acceptance criteria are satisfied.

## Hard constraints

- Preserve the exported Astryx Playground UI exactly: Astryx 0.5.2, StyleX, `PESDacMockupTheme`, dialog copy/sizes/behavior. Expect ZERO JSX changes (error dialog, gate dialog, copy all byte-identical). If you believe JSX must change, stop and report instead.
- Do NOT lengthen the 800ms middleware timeout as the fix. Do NOT add unbounded retry. Do NOT auto-retry any mutation (rename/link/password untouched).
- Do NOT regress the genuine-guest instant path: existing `initial-session.test.ts` passes UNMODIFIED — extend it, never rewrite its assertions.
- Do NOT overload `absent` for the unknown state; do NOT reuse tag `null` for gave-up. Three serialized states, mutually distinguishable.
- Retryable set is closed: TypeError / AbortError / 5xx / AuthServiceError / 429-once-capped-5s. Everything else (401, identity-changed, 400/403/404, logout window) keeps current handling on EVERY attempt, not just the first.
- Never log PII/tokens/profile contents (method + path + outcome only). Synthetic fixtures only.
- Work on a new branch `fix/auth-loading-flash` (create it once with `git checkout -b`). Never touch main. Do not commit, push, or reset files.
- Do not make a task larger than five touched files. Split it if necessary.
- No new test dependencies. node:test + existing stub styles; no real timers in unit tests (inject sleep).

## Required working method

Work in task order T1-T4 from the plan (T2/T3 need T1's evidence; T2+T3 may parallelize after). Before each edit: inspect the current implementation, make the smallest compatible change, run the focused checks, report. For every task use this report structure:

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

### T1 — evidence first, no edits

- S1: logged-in refresh, DevTools open — capture the SSR doc's tag state (`null` despite a valid session cookie = the misfire) and the gate paint-then-close sequence with timings. Note whether SSR took >800ms (server log if present).
- S2: cold-backend login (restart backend first for a true cold start) with Network recording — capture WHICH leg fails first (token/me/profile) with URL/status/body/latency, then the manual-retry success. This sizes the FR2 backoff: fast cold rejects fit 300/900ms; full-timeout failures do not.
- Time one cold `/api/v1/auth/me` post-restart. Record all numbers; judge the backoff budget against them explicitly.
- Do not design the tag or the retry from memory of this prompt. The evidence decides details (e.g. if failures are never transient, T3 is report-only).

### T2 — unknown state (S1)

- Middleware: three outcomes (user / proved-guest / unknown) with the one-line `session=unknown` log; audit EVERY `Astro.locals.session` reader for null-tolerance and document each (readers that can't wait keep null-safe behavior + comment).
- `InitialSession.astro`: third serialized state + extended contract comment (no relocation).
- Tag reader: explicit unknown (distinguishable from absent in tests even though both resolve `loading`); resolver adds the unknown row; pending branch maps per table. Keep the raw-contented cache and SSR guard exactly as-is.
- Extend `initial-session.test.ts`: unknown×match, unknown×mismatch, serializer guest/user/unknown/absent/malformed. The six existing cells stay byte-identical.

### T3 — silent retry (S2; skip cleanly if T1 shows no transience)

- Pure helper, injectable sleep; matrix-tested (retryable vs terminal vs 429-cap vs exhaustion vs identity-reset).
- Effect: `checking` renders null through retries; existing `isLogoutTransition() || isTransitionNoise(error)` guard runs per attempt; exhaustion falls into the CURRENT error path untouched; manual retry resets and reruns untouched.
- Prove the bound: a test that counts attempts on persistent failure (exactly 3 total, no timers).

### T4 — gates and browser truth

- `npm.cmd test`, `astro check`, `build`, `git diff --check`; backend `pytest` green with zero backend diffs (prove via `git status --short`).
- Browser (user-assisted as needed): throttled refresh-while-authed (no gate pre-resolve); genuine-guest instant gate; cold login (no pre-exhaustion dialog); persistent failure (exact current dialog + working manual retry); desktop + narrow; clean console.
- Forcing a live unknown-state in-browser is awkward (needs slow SSR): say so, let unit tests + guest-path browser proof carry it. Do not fabricate the coverage.

## Commands to run

From `frontend/`:

```powershell
npm.cmd test
npm.cmd run astro -- check
npm.cmd run build
```

From `backend/` (prove untouched-and-green only):

```powershell
python -m pytest -q
```

From the repository root:

```powershell
git diff --check
git status --short
```

Paste exact failing command + error if anything fails; do not weaken tests or suppress warnings to pass.

## Acceptance checklist

- T1-T4 completed in order (T2/T3 parallel only after T1), or deviations explained.
- S1 evidence captured (null-tag-on-valid-session + gate timing); S2 evidence captured (failing leg + latency + retry success).
- Unknown state implemented with three distinguishable serialized states; existing six resolver cells byte-identical and green.
- Retry bounded (3 total, 300/900ms, 429-cap-5s), terminal classes bypass, identity reset, exhaustion dialog identical.
- Full gates green; backend untouched; Astryx UI/copy/layout unchanged; no new dependencies.
- Browser matrix done (possibly user-assisted) with the unknown-state coverage gap stated honestly.

## Final response format

Report:

1. S1/S2 evidence chains with captured artifacts and timings;
2. exact files changed and why (tag shape choice, retry shape choice);
3. SSR `locals` consumer audit table;
4. tests and browser routes run with results;
5. unresolved risks (unknown-state live forcing, backoff-vs-cold-start fit) and follow-ups (timeout-budget suspicion if prod timings warrant their own spec).
