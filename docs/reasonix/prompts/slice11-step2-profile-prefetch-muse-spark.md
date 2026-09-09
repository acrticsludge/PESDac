# Muse Spark implementation prompt: onboarding profile pre-fetch (slice-11 Step 2, gated)

You are Muse Spark working in the PESDac repository. Work through the plan one task at a time on medium reasoning. Read these first, in order:

- `AGENTS.md`
- `docs/slices/slice-11-popup-latency.md` (§Step 2 + the Step 1 implementation-status note)
- `docs/reasonix/specs/slice11-step2-profile-prefetch.md`
- `docs/reasonix/plans/slice11-step2-profile-prefetch-plan.md`

Key source files (open them before measuring or editing):

- `frontend/src/lib/auth.ts` (token mint + `apiGetMe`/`apiGetProfile` readers — T1 read-only reference)
- `frontend/src/middleware/auth.ts` (session bootstrap; Design A touchpoint)
- `frontend/src/components/layout/InitialSession.astro` (embed pattern to mirror for me/profile tags)
- `frontend/src/components/auth/OnboardingDialog.tsx` (effect chain + dialog conditions — read-only unless T2 GO)
- `frontend/src/pages/new.astro`, `frontend/src/pages/profile.astro` (Design B touchpoints)

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

First MEASURE whether slice-11 Step 2 is worth building at all (T1). Most likely outcome: NO-GO with a dated slice note and zero code. Only on a GO verdict (chain p50 > ~1s attributable to token+me+profile) implement the server prefetch with consume-then-verify (T2), then prove the win with the same ruler (T3). After each task, stop and report; T2 is forbidden unless T1 says GO.

## Hard constraints

- T1 is read-only except possibly a one-line dated verdict note in slice-11. No code, no refactor, no "while I'm here".
- NO-GO and ROUTE-TO-4 are success outcomes. Do not build to justify the spec; do not massage timings to reach GO.
- On GO: no backend changes, no new routes, NO token material in embedded HTML (assert tag key sets in tests), 800ms shared server budget, tagless fallback rendering exactly today's behavior.
- Embedded user-id MUST match the live session user-id at consume time or tags are ignored; live revalidation wins disagreements; 401 on any leg means no tags and existing global flows.
- Preserve the exported Astryx Playground UI exactly; dialog JSX untouched (logic/data only). No theme/CSS/dependency changes.
- Never log PII, tokens, or profile contents; method + path + timeout only. Synthetic fixtures only.
- Work on a new branch `fix/onboarding-prefetch` (create it once with `git checkout -b`). Never touch main. Do not commit, push, or reset files.
- Do not make a task larger than five touched files. Split it if necessary.

## Required working method

Work in task order T1-T3 from the plan (T2/T3 exist only on GO). Before each edit: inspect the current implementation, make the smallest compatible change, run the focused checks, report. For every task use this report structure:

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

### T1 — measure, then judge

- Same machine, same servers for every run (`backend/` + `frontend/`, single listener per port — verify, don't assume).
- Three user classes × three runs, legs split (token-mint / me / profile). New-user, returning-not-onboarded, returning-onboarded (latter: dialog must stay shut; record any new wasted work as disqualifying).
- Compare against the ~1s threshold with ±200ms gray zone defaulting to NO-GO. Token-mint-dominated -> ROUTE-TO-4 (request a Step 4 spec; write no code).
- On NO-GO: append the dated verdict note to slice-11 (timings + threshold + close-out) and stop. That note is the deliverable.

### T2 — implement (GO ONLY)

- Write the A-vs-B justification from the T1 leg split before coding (blast radius vs duplication).
- Authenticated-only; parallel legs; shared 800ms budget; any timeout/throw/401 -> tagless render, zero error UI.
- Reader fast paths with user-id match + background revalidation (live wins; offline/5xx keeps embedded silently; 401 flows global).
- Tests: consume/ignore matrix, timeout fallback, no-token-in-tags assertion, revalidation-wins logic. node:test + existing stub styles only.

### T3 — re-measure and lock

- Repeat the EXACT T1 matrix; report deltas, not vibes. AC5 (onboarded-user, zero regression) is explicit — a regression fails the task even if the dialog got faster.
- Full gates: `npm.cmd test`, `astro check`, `build`, `git diff --check`; backend `pytest` green with zero backend diffs (prove via `git status --short`).
- Browser matrix user-assisted: desktop + narrow, user-switch + offline spot checks, clean console.
- Delta < ~30% or any AC5 regression: recommend revert, plainly.

## Commands to run

From `frontend/` (T2/T3 only; T1 needs no commands beyond servers + browser):

```powershell
npm.cmd test
npm.cmd run astro -- check
npm.cmd run build
```

From `backend/` (prove untouched-and-green):

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

- T1 verdict (GO / NO-GO / ROUTE-TO-4) recorded with the timing table; NO-GO/ROUTE-TO-4 closed with a slice note and zero code.
- (GO only) AC2-AC4 behaviors proven via Network + tests; no tags on guest/timeout/401 paths.
- (GO only) AC5: onboarded users show zero new requests and zero timing regression.
- Full gates green; backend untouched; Astryx UI/theme unchanged; no new dependencies.
- Slice note updated with the final outcome including measured deltas.

## Final response format

Report:

1. T1 timing table and verdict, with the leg split;
2. (GO only) design choice (A vs B) with justification, exact files changed and why;
3. measured deltas T1-vs-T3 per user class;
4. tests and browser routes run with results;
5. unresolved risks (first-paint budget, stale-data doctrine limits) and follow-ups (Step 4 trigger conditions).
