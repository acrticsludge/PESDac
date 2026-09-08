# Plan: instant guest AuthGate via embedded initial session (slice-11 Step 1 completion)

Spec: `docs/reasonix/specs/auth-gate-instant-guest-fix.md`
Slice: `docs/slices/slice-11-popup-latency.md` (Steps 1-4; this plan completes Step 1's guest path + staleness hardening, subsumes Step 3, defers Steps 2/4 per the slice's own optionality)
Status: Proposed
Branch rule: create `fix/auth-gate-instant-guest` from main; never commit to main; do not push/commit unless the user explicitly asks.

## Task list (vertical slices, in order)

### T1 — Evidence: epoch-bump closure, cookie attributes, SSR tag, baseline

- Objective: prove the mechanism is sound on current code before designing around it; capture the guest-gate delay baseline.
- Areas: `frontend/src/lib/auth.ts` (epoch + `clearAuthCache` callers), BetterAuth cookie attributes, SSR HTML of `/new` + `/profile`, live workers on :4321/:8000.
- Steps:
  1. `git status --short` (do not touch unrelated modifications).
  2. Confirm the COMPLETE `clearAuthCache()` caller list (known: `signIn`, `signUp`, `signInWithGoogle`, `apiFetch` 401 branch, `apiLogout`; verify the account-deletion path too). Every caller must be an identity transition; any non-transition caller is a spec violation to report, not silently accommodate.
  3. Confirm BetterAuth session-cookie attributes (`httpOnly` expected) via DevTools Application tab on an authenticated session, or by reading the cookie config in `node_modules/better-auth/dist/cookies/*`. If the session cookie is JS-readable, report it (the spec's no-cookie-sniffing rationale changes; do NOT switch mechanisms without human approval).
  4. Start current dev servers from `backend/` + `frontend/`; single listener per port (`Get-NetTCPConnection -LocalPort 8000,4321`). Curl `GET /new` as guest: assert `<script id="pesdac:initial-session" type="application/json">null</script>` is present in the HTML.
  5. Browser baseline (user-assisted if needed): guest `/new`, DevTools Performance/Network — record interactive-to-gate-dialog time (expected: seconds, matching the slice report).
- Acceptance: caller list written down with line refs; cookie attributes recorded; AC1 curl probe passing on CURRENT code (tag exists; only the client use of it is missing); baseline timing noted.
- Verification: probe outputs + DevTools notes pasted in the task report.
- Rollback: n/a (read-only).
- Files touched: none (docs notes only).

### T2 — Tri-state tag read + pure resolver + `useAuth` wiring

- Objective: implement spec §6 FR1-FR2 with zero JSX/CSS change.
- Files: `frontend/src/lib/auth.ts` ONLY (plus the new test file in T3; max two files for T2+T3 combined).
- Changes:
  1. Refactor the tag read to tri-state `{ present: boolean; user: SessionUser | null }`: present-guest = literal `null` in a present tag; absent = missing tag or malformed JSON (fail closed). Keep the existing validation (string `id` + `email`) and the raw-contented cache (Astro-transition safe).
  2. Add exported pure `resolveInitialAuth(tag, epochAtMount, currentEpoch)` implementing the §6 FR2 table exactly: epoch mismatch -> `loading`; absent -> `loading`; present-guest -> `guest`; present-user -> `authenticated`.
  3. `useAuth()` pending branch: latch mount epoch via `useState` lazy initializer (`useState(getAuthEpoch)` — NOT a render-time ref write); delegate to the resolver; map `authenticated` back to `{ status: "authenticated", user: tag.user }`, `guest` to `{ status: "guest" }`, `loading` to `{ status: "loading" }`. Post-pending, SSR, and pre-effect branches byte-identical in behavior.
  4. Code comments must record: why epoch (not cookies — httpOnly, per T1), why absent/mismatch fail closed to `loading`, and the BFCache accepted limitation.
- Acceptance: `npm.cmd test` green (existing suites unmodified); `astro check` 0 errors; the six FR2 cells behave per table in a scratch harness (formalized as tests in T3).
- Verification: `npm.cmd test`, `npm.cmd run astro -- check` from `frontend/`.
- Rollback: revert `auth.ts`; behavior returns to pending-always-`loading`.
- Dependencies: T1 (caller list + cookie attributes gate the mechanism choice).

### T3 — Regression tests + full verification + slice note

- Objective: lock the fix and prove no regressions; leave the trail for the deferred steps.
- Files: new `frontend/tests/initial-session.test.ts`; one short "Implementation status" note appended to `docs/slices/slice-11-popup-latency.md` (Step 1 guest path done + Step 3 subsumed + Steps 2/4 deferred with reason; no other slice edits).
- Tests to add (node:test, no DOM library — stub `globalThis.document.getElementById` returning `{ textContent }`, mirroring the existing fake-window harness style):
  - Resolver truth table: all six (tag × epoch) cells.
  - Tag reader: present-user, present-guest, missing tag, malformed JSON, wrong-shape JSON (e.g. missing `id`) -> absent/user/null as specified.
  - Latch semantics: resolver with bumped epoch forces `loading` for both stale-user and stale-guest tags.
- Commands (exact):
  ```powershell
  # from frontend/
  npm.cmd test
  npm.cmd run astro -- check
  npm.cmd run build
  # from repo root/
  git diff --check
  ```
- Backend suite: run `python -m pytest -q` from `backend/` to prove untouched-and-green (expect zero backend file diffs).
- SSR re-probe: guest `GET /new` tag curl (AC1) + authenticated-tag shape check if a session is available.
- Browser matrix (user-assisted; build alone is NOT acceptance for AC5): guest `/new` gate within ~1 frame of interactive; authenticated `/new` no gate flash; in-page logout->relogin no stale paint; desktop + <=640px; clean console.
- Acceptance: all commands green, AC1-AC7 checked, task reports filed.
- Rollback: revert test file + `auth.ts` + slice note independently; no production data involved.
- Dependencies: T2.

## Dependency order

```text
T1 (evidence: caller list, cookie attrs, tag curl, baseline)
 └─ T2 (resolver + useAuth wiring)
     └─ T3 (tests + full gates + browser matrix + slice note)
```

Strictly serial: T2's mechanism depends on T1's closure proof; T3's assertions encode T2's table.

## File touch budget

- Max five touched source files total (expected two): `frontend/src/lib/auth.ts`, `frontend/tests/initial-session.test.ts` (new), plus the slice-11 status note. No `.astro`, component, backend, theme, CSS, or dependency changes. If implementation threatens to exceed this, split and report rather than sprawling.

## Risks

- Hidden identity transition that bypasses `clearAuthCache()` (the account-deletion path is the prime suspect): T1's caller audit exists to catch it. If found, add the one-line bump there — do not weaken the resolver.
- `authClient.useSession()` pending semantics differing across BetterAuth minor versions (e.g. synchronous resolve, no pending window): the change degrades gracefully (post-pending branch is untouched), but flag any version drift found during T1.
- BFCache restore serving a stale tag with unchanged epoch: accepted limitation (spec §11); live `useSession` converges. Do not build invalidation in this plan.
- Timing claims (AC5) cannot be proven without a real browser; unit tests prove the decision logic, curl proves the SSR input, but the frame-level gate timing needs the user's DevTools. Say so explicitly in the final report rather than claiming it from build output.
