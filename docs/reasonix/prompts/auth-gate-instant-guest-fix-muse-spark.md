# Muse Spark implementation prompt: instant guest AuthGate (slice-11 Step 1 completion)

You are Muse Spark implementing in the PESDac repository. Work through the plan one task at a time on medium reasoning. Read these first, in order:

- `AGENTS.md`
- `docs/slices/slice-11-popup-latency.md`
- `docs/reasonix/specs/auth-gate-instant-guest-fix.md`
- `docs/reasonix/plans/auth-gate-instant-guest-fix-plan.md`

Key source files (open them before editing):

- `frontend/src/lib/auth.ts:156-295` (epoch, `readInitialSession`, `useAuth`)
- `frontend/src/lib/auth.ts:846-860` (`clearAuthCache` + epoch bump; confirm full caller list in T1)
- `frontend/src/components/layout/InitialSession.astro` (embedded tag; read-only)
- `frontend/src/components/auth/AuthGate.tsx:36-58` (guest -> dialog; read-only)
- `frontend/src/middleware/auth.ts` (session bootstrap; read-only)
- `frontend/src/pages/new.astro:22`, `profile.astro:22` (tag inclusion; read-only)
- `frontend/tests/link-password.test.ts:66-95` (fake-window harness style to mirror for the document stub)

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

Complete slice-11 Step 1's missing guest path: a logged-out visitor on a tagged page must resolve `useAuth() -> guest` while `useSession` is still pending (gate opens in ~1 frame, not 5-10s), while stale embedded hints after in-page identity transitions fail closed to `loading`. Start with T1. After each task, stop and report; continue only when that task's acceptance criteria are satisfied.

## Hard constraints

- Preserve the exported Astryx Playground UI exactly: Astryx 0.5.2, StyleX, `PESDacMockupTheme`, dialog sizes, spacing, typography, colors, radii, behavior. This task should change NO JSX and NO CSS; if you believe a component must change, stop and report instead.
- Do NOT build slice-11 Step 3 (`__PESDAC_NO_COOKIE__`, `<html>` class machinery) — the spec subsumes it. Do NOT build Steps 2 or 4 (server profile pre-fetch, pre-minted token).
- Do NOT sniff `document.cookie` for session state (expected httpOnly; T1 confirms — if readable, stop and report rather than switching mechanisms).
- Do NOT add test dependencies (no jsdom/happy-dom, no React test renderer). node:test + a `globalThis.document` stub only.
- Do NOT touch backend files, `.astro` pages, middleware, gate, theme, global CSS, or dependency versions.
- Work on a new branch `fix/auth-gate-instant-guest` (create it once with `git checkout -b`). Never touch main. Do not commit, push, or reset files.
- Do not make a task larger than five touched files. Split it if necessary.
- Do not guess at the epoch-bump closure. T1's caller audit is load-bearing: if any identity transition bypasses `clearAuthCache()`, add the bump there, never weaken the resolver.
- Never log session contents, tokens, or cookies in code or tests. Fixture users are synthetic (`id: "u-test-1"` style), never real.

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

- Enumerate EVERY `clearAuthCache()` caller with file:line; each must be an identity transition (sign-in/up, Google sign-in, logout, 401 handling, account deletion). A non-transition caller, or a transition that bypasses it, is a finding to report before T2.
- Record BetterAuth session-cookie attributes (httpOnly/secure/sameSite) from a live authenticated session or `node_modules/better-auth/dist/cookies/*`. Expected: httpOnly -> document.cookie gating impossible, epoch mechanism confirmed.
- Single listener per port for all probes (`Get-NetTCPConnection -LocalPort 8000,4321`; servers started from `backend/` + `frontend/`). Guest `GET /new` must contain `<script id="pesdac:initial-session" type="application/json">null</script>`.
- Record the guest baseline if a browser is available (interactive -> gate paint); otherwise note it as user-assisted acceptance for T3.
- Do not edit `auth.ts` based on timing vibes. The defect is structural (null conflation in `readInitialSession` + unconditional trust in the pending branch) and already evidenced; T1 closes the mechanism's preconditions, nothing more.

### T2 — resolver + wiring

- Tri-state the tag read (`present` vs `present-guest-null` vs `present-user`); malformed/wrong-shape JSON is `absent` (fail closed). Keep the raw-contented cache for Astro-transition safety.
- Pure `resolveInitialAuth(tag, epochAtMount, currentEpoch)` implementing the spec §6 FR2 table verbatim: epoch mismatch -> `loading`; absent -> `loading`; present-guest -> `guest`; present-user -> `authenticated`.
- Latch mount epoch with a `useState` lazy initializer. No render-time ref writes. Pending branch delegates to the resolver; every other `useAuth` branch stays behavior-identical.
- Comments must state: why epoch-not-cookies, why absent/mismatch fail closed to `loading`, and the BFCache accepted limitation. Keep them terse (3-5 lines each, this file's existing style).

### T3 — tests + gates + slice note

- New `frontend/tests/initial-session.test.ts`: six resolver cells, tag-reader cases (user/guest/missing/malformed/wrong-shape), latch semantics (bumped epoch + stale tag either direction -> `loading`). Synthetic fixtures only.
- Existing frontend suites must pass UNMODIFIED. Backend `pytest` must pass with ZERO backend diffs (prove it with `git status --short` showing no `backend/` modifications).
- Re-run the AC1 curl probe post-change. Browser matrix is user-assisted: guest/authenticated/just-logged-out × `/new` × desktop/narrow, gate timing + clean console. Do not claim AC5 from build output.
- Append the "Implementation status" note to `docs/slices/slice-11-popup-latency.md` (Step 1 guest path done, Step 3 subsumed with reason, Steps 2/4 deferred with reason). No other doc edits.

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

Also verify in a real browser (with user assistance): guest `/new` gate within ~1 frame of interactive; authenticated `/new` no gate flash; in-page sign-in shows no gate flash during the pending window; in-page logout shows no false-authenticated flash; narrow viewport identical; console clean. Paste exact failing command + error if anything fails; do not weaken tests or suppress warnings to pass.

## Acceptance checklist

- T1-T3 completed in order, or deviations explained.
- Complete `clearAuthCache()` caller list recorded; all callers are identity transitions (or the exception was fixed by adding a bump).
- Cookie attributes recorded; epoch mechanism justified in code comments.
- Guest `/new` SSR HTML contains the `null` initial-session tag (curl, before and after).
- Resolver truth table fully unit-tested; tag-reader edge cases tested; no new test dependencies.
- `useAuth` return type and all non-pending branches unchanged; no JSX/CSS diff anywhere.
- Frontend tests, Astro check, build, `git diff --check` pass; backend suite green with no backend diffs.
- Browser matrix done (possibly user-assisted) with timings noted; BFCache limitation disclosed, not solved.
- Slice-11 status note appended; Astryx UI, theme, and behavior unchanged.

## Final response format

Report:

1. root cause for the guest-path gap (null conflation + unconditional stale trust), with evidence;
2. exact files changed and why;
3. epoch-bump closure table and cookie-attribute findings (no secret values);
4. tests and browser routes run with results;
5. unresolved risks (BFCache, any version drift found) and recommended follow-ups (Steps 2/4 triggers).
