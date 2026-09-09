# Plan: onboarding profile pre-fetch (slice-11 Step 2, measurement-gated)

Spec: `docs/reasonix/specs/slice11-step2-profile-prefetch.md`
Slice: `docs/slices/slice-11-popup-latency.md` §Step 2
Status: Proposed
Branch rule: create `fix/onboarding-prefetch` from main; never commit to main; do not push/commit unless the user explicitly asks.

## Task list (vertical slices, in order)

### T1 — Measure and verdict (read-only; the whole task for most outcomes)

- Objective: produce the GO / NO-GO / ROUTE-TO-4 verdict on real timings. Expect NO-GO until proven otherwise.
- Areas: live dev servers (:4321 Astro, :8000 backend), user browser DevTools, `frontend/src/lib/auth.ts` (token mint + `apiGetMe`/`apiGetProfile` readers, read-only reference), `OnboardingDialog.tsx` (effect chain, read-only).
- Steps:
  1. `git status --short` (do not touch unrelated modifications).
  2. Single listener per port; current `main` + Step 1 code running from `backend/` + `frontend/`.
  3. For each user class (new signed-in / returning not-onboarded / returning onboarded), 3 runs: record `useSession`-resolved -> dialog-open (or dialog-stays-shut) split into token-mint / `apiGetMe` / `apiGetProfile` legs (Network + Performance).
  4. Verdict by spec §6 FR1: p50 chain > ~1s attributable to token+me+profile -> GO (with the leg split justifying design A vs B); token-mint-dominated -> ROUTE-TO-4 (stop, request Step 4 spec); else NO-GO (append dated note to slice-11, close with zero diff).
- Acceptance: timing table + verdict written; on NO-GO/ROUTE-TO-4 the slice note is the ONLY change.
- Verification: DevTools screenshots/exports referenced in the task report.
- Rollback: n/a (read-only, or revert the one-line slice note).
- Files touched: at most `docs/slices/slice-11-popup-latency.md` (verdict note).

### T2 — Implement the winning design (GO only; forbidden otherwise)

- Objective: server prefetch + consume-then-verify per spec §6 FR2/FR3.
- Files (max five): middleware OR page frontmatters + one shared server helper, `frontend/src/lib/auth.ts` (reader fast paths), one test file, slice note.
- Changes:
  1. Document the A-vs-B choice with the T1 leg split as justification (duplicated code vs middleware blast radius).
  2. Authenticated-only prefetch, shared 800ms budget, parallel legs; timeout/throw/401 -> render tagless (F3), no error UI.
  3. Embed `{ me, profile }` with user-id; readers consume only on user-id match, then background-revalidate with live-wins; 401 flows global untouched.
  4. NO token material anywhere in the tags (assert in tests: embedded payload keys enumerated).
- Acceptance: AC2-AC5 behaviors; no tag on guest/timeout/401 paths (tests).
- Verification: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build` + browser Network proofs.
- Rollback: revert branch; client chain untouched underneath.
- Dependencies: T1 GO verdict (proceeding on anything else violates the spec — stop instead).

### T3 — Lock, re-measure, report

- Objective: prove the win (or lack thereof) with the same ruler as T1.
- Steps:
  1. Repeat the T1 timing matrix on the branch; record deltas per leg and per user class (AC5 regression check for onboarded users is explicit).
  2. Full gates: `npm.cmd test`, `astro check`, `build`, `git diff --check`; backend `pytest` green with zero backend diffs.
  3. Browser matrix (user-assisted): desktop + narrow, clean console, user-switch + offline-revalidation spot checks.
  4. If measured delta < ~30% or AC5 regresses: report honestly with a revert recommendation — do not dress up a null result.
- Acceptance: AC1-AC6 checked; timing deltas filed; slice note updated with outcome.
- Rollback: revert branch (single-purpose, no data).
- Dependencies: T2.

## Dependency order

```text
T1 (measure -> GO / NO-GO / ROUTE-TO-4)
 ├─ NO-GO / ROUTE-TO-4: slice note, done, zero code
 └─ GO only: T2 (implement) -> T3 (re-measure + gates)
```

T2 is forbidden on any verdict but GO. T3's ruler is T1's matrix — same classes, same splits.

## File touch budget

- T1: at most the slice note. GO path: max five source files. Any design needing backend work, new routes, or token embedding is out of spec — stop and report (those belong to a different spec).

## Risks

- Measuring dev-server timings as prod truth: dev SSR overhead inflates absolute numbers; compare DELTAS (T1 vs T3 on the same machine), never absolutes against the slice's old table.
- Prefetch slowing first paint: the 800ms shared budget + tagless fallback exists for this; T3's onboarded-user timing is the tripwire.
- Stale-embedded-data bugs: the user-id match + live-wins doctrine + 401-fail-closed are all load-bearing; any simplification here is a spec violation, not an optimization.
- Null-result politics: T3 must report a miss as a miss. The NO-GO close-out is a designed success path — use it.
