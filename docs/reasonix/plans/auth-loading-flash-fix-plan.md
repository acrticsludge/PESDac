# Plan: loading flashes — gate on refresh, profile error after login

Spec: `docs/reasonix/specs/auth-loading-flash-fix.md`
Slice context: `docs/slices/slice-11-popup-latency.md` (Step 1 implementation-status note — this work narrows, not reverts, the instant-guest fast path)
Status: Proposed
Branch rule: create `fix/auth-loading-flash` from main; never commit to main; do not push/commit unless the user explicitly asks.

## Task list (vertical slices, in order)

### T1 — Evidence: prove both misfire paths on current code (read-only + live observation)

- Objective: turn the reported flashes into captured evidence with the exact code path for each.
- Areas: `frontend/src/middleware/auth.ts:1-31`, `frontend/src/components/layout/InitialSession.astro`, `frontend/src/lib/auth.ts:197-330` (tag + resolver + pending branch), `frontend/src/components/auth/AuthGate.tsx:36-58`, `frontend/src/components/auth/OnboardingDialog.tsx:100-195`, live :4321/:8000.
- Steps:
  1. `git status --short` (do not touch unrelated modifications).
  2. S1 proof: logged-in refresh with DevTools open — capture (a) whether the SSR HTML carries tag `null` despite a valid session cookie (View Source on the refreshed doc), and (b) the gate paint before `useSession` resolves (Performance: interactive -> dialog -> dialog-close). Correlate with middleware timing (does the SSR response take >800ms? server log line if present).
  3. S2 proof: fresh login with Network throttling (or cold backend after restart) — capture the FIRST `apiGetMe`/`profiles/me`/`token` failure (URL/status/body) and the error dialog paint; then the manual-retry success. Record first-failure latency (sanity-checks the FR2 backoff budget) and which leg failed (token vs me vs profile).
  4. Record backend cold-start behavior: time the first `/api/v1/auth/me` after a backend restart (is "cold backend" 500ms or 5s?).
- Acceptance: written S1 + S2 evidence chains (HTML tag state, failing leg, latencies); FR2 backoff budget confirmed sane against measured first-failure latency; AC1/AC3 baselines noted.
- Verification: HTML snippets, Network captures, timings pasted in the task report.
- Rollback: n/a (read-only).

### T2 — Unknown-state initial session (S1)

- Objective: middleware distinguishes proved-guest from gave-up; resolver fails the latter closed to `loading`.
- Files (max three): `frontend/src/middleware/auth.ts`, `frontend/src/components/layout/InitialSession.astro`, `frontend/src/lib/auth.ts` (tag type + reader + resolver + pending branch; `useAuth` return type unchanged).
- Changes:
  1. Middleware: timeout/throw -> unknown locals (distinct from null-guest); add the one-line `session=unknown` server log (method + path + outcome, no PII). Affirmative no-session stays null-guest; session stays user. SSR consumers of `locals` MUST keep working (null-safe: unknown reads as guest for SSR page decisions that can't wait — document each consumer audited).
  2. `InitialSession.astro`: serialize the third state distinctly; extend the header-contract comment (no relocation).
  3. Tag reader: quad-state with unknown explicit (NOT overloading absent — absent and unknown share today's `loading` outcome but stay distinguishable); resolver gains the unknown row (`loading` on match AND mismatch — mismatch is already `loading` for all kinds); pending branch maps per updated table.
  4. Tests (extend `frontend/tests/initial-session.test.ts` — do NOT rewrite it; existing six cells must pass unmodified): unknown×match -> `loading`; unknown×mismatch -> `loading`; serializer cases (guest/user/unknown/absent/malformed); middleware-outcome unit? (middleware imports the BetterAuth instance — if it can't load in node:test without env/DB, test the mapping via a pure helper extracted from the middleware, same dependency-free doctrine as `link-password-server.ts`).
- Acceptance: AC1 + AC2 (existing suite green unmodified; new unknown tests green; guest curl shows proved-guest literal).
- Verification: `npm.cmd test`, `npm.cmd run astro -- check` from `frontend/`.
- Rollback: revert the three files; instant-guest-everything (with flashes) returns.
- Dependencies: T1 (evidence must show the null-tag-on-valid-session capture before redesigning the tag).

### T3 — Onboarding silent retry (S2)

- Objective: transient check failures retry silently per spec §6 FR2; error dialog only on exhaustion.
- Files (max two): `frontend/src/components/auth/OnboardingDialog.tsx`, one test file (new `onboarding-retry.test.ts` OR extend an existing suite if the helper lives in `auth.ts` — keep the helper pure and framework-free).
- Changes:
  1. Pure retry policy helper (injectable sleep; classifies retryable vs terminal incl. 429-once-capped-at-5s; attempt reset on identity change / manual retry).
  2. Effect wiring: `checking` stays null-rendered through retries; per-attempt failures run the EXISTING `isLogoutTransition() || isTransitionNoise(error)` guard (not just the first); exhaustion -> current error path byte-identical; manual retry resets and re-runs (current behavior preserved).
  3. Tests: retryable matrix, terminal fast-paths, exhaustion-opens-error, attempt-reset, 429-cap. No real timers.
- Acceptance: AC3 + AC4 (stubbed-transient never dialogs; stubbed-persistent dialogs exactly as today; 401/identity-changed bypass).
- Verification: `npm.cmd test` + browser throttled-backend pass if feasible.
- Rollback: revert the two files; single-attempt behavior returns.
- Dependencies: T1 (first-failure latency + failing-leg evidence sizes the policy; if T1 shows failures are never transient, T3 becomes report-only — say so, don't build blind).

### T4 — Full gates + browser matrix + close-out

- Objective: prove no regressions and file the verification story.
- Steps:
  1. `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build` (frontend); `python -m pytest -q` (backend, expect zero backend diffs — prove via `git status --short`); `git diff --check`.
  2. Browser matrix (user-assisted): refresh-while-authed throttled (no gate paint pre-resolve); genuine guest instant gate (regression pin); cold-backend login (no error dialog pre-exhaustion); persistent-failure error dialog + manual retry; desktop + <=640px; clean console.
  3. Confirm the five-touched-file budget held; file per-task reports.
- Acceptance: AC1-AC6 checked.
- Rollback: per-file reverts; no data anywhere.
- Dependencies: T2 + T3.

## Dependency order

```text
T1 (evidence: tag capture, failing leg, latencies, budget sanity)
 ├─ T2 (unknown-state tag) ─┐
 └─ T3 (silent retry) ───────┤ (independent after T1; may run in parallel)
                             └─ T4 (gates + browser matrix)
```

T2 and T3 touch disjoint files and may parallelize; both need T1's evidence (T3 especially: no measured transience, no retry loop).

## File touch budget

- Max five touched source files total (expected: middleware, InitialSession.astro, auth.ts, OnboardingDialog.tsx, plus tests). Exceeding it means scope drift — split and report.

## Risks

- Forcing the unknown state in a live browser is awkward (needs a >800ms SSR session read): T2's unit tests carry the proof; the browser matrix covers the genuine-guest and happy paths, plus throttled-refresh observation. Say this plainly in the report.
- SSR `locals` consumers beyond InitialSession may depend on null-means-guest: T2 audits every `Astro.locals.session` reader; any consumer that can't tolerate unknown keeps null-safe behavior with a comment.
- Retry policy masking a real outage as a slow hang: bounded attempts + unchanged checking-null-render + exhaustion dialog keep worst case to seconds, not a spinner forever. T3 proves the bound in tests (attempt counting, no real timers).
- First-failure latency exceeding the backoff budget (e.g. full 15s API timeouts, not fast cold-start rejects): T1 measures it; if so, the policy needs longer backs or the fix is elsewhere (backend cold start) — report, don't stretch blindly.
