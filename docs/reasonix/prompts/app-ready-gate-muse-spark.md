# Muse Spark 1.3 implementation prompt: app readiness gate (medium effort)

You are Muse Spark 1.3 implementing in the PESDac repository. Work on
medium effort. Read these first, in order:

- `AGENTS.md` (Astryx/UI rules in full — this stream touches components)
- `docs/reasonix/specs/app-ready-gate.md` (§3 is your build order, §4 is
  your per-surface contract)
- `docs/reasonix/plans/app-ready-gate-plan.md` (your branch + file
  ownership)
- `docs/slices/slice-12-loading-and-optimistic-ui.md` (Astryx mapping +
  skeleton/disabled conventions)

Key source files (open before editing):

- `frontend/src/lib/session.ts` (predicate home: `getProfileSeedPending`,
  `identitySeedKey`, `getChatHydratedKey`, `getChatMessagesStatus`,
  `useSessionVersion` reactivity to preserve)
- `frontend/src/lib/auth.ts` (`useAuth` / `useProfile` status shapes —
  read only, NEVER edit)
- `frontend/src/components/Pesdac.tsx` (sidebar sections, welcome
  `ChatComposer`, existing account loading skeleton)
- `frontend/src/components/chat/ThreadView.tsx` (existing skeleton
  branch + `SkeletonThread`, thread composer)
- Astryx APIs (verify in `node_modules/@astryxdesign/core/dist` before
  use — do not guess props): `Chat/ChatComposer.d.ts` (`isDisabled`),
  `SideNav` item props (`isDisabled`), `Skeleton` props, `Toast`
  untouched.

Before touching code, run `git status --short`. Existing
modified/untracked files belong to the user or another run. Do not
reset, clean, checkout, overwrite, or commit them. If another run is
inside your owned files, integrate around it (keep their lines, build
beside them) and report the collision instead of overwriting.

## Mission

Implement the spec: while user data loads, the page is skeleton +
non-interactive (no dead clicks); chat rows skeleton on their own axis
(`!U` forces chat skeletons even when chat data is ready; `U && !C`
keeps only the chat skeleton); the `/new` welcome composer is a fixed-
height skeleton until user data is ready, with drafts preserved across
the swap.

## Hard constraints

- Touch ONLY: `frontend/src/lib/session.ts` (predicate + chatReady
  helper + re-exports, nothing else in that file), the two components
  above, `frontend/tests/app-ready-gate.test.ts` (new). Existing
  frontend tests: append-only, never rewrite assertions.
- NEVER touch `frontend/src/lib/chat-sync.ts`, `frontend/src/lib/
  auth.ts`, anything under `backend/`, the theme, or global CSS. No new
  dependencies. No custom overlay divs, no DOM library in tests (stub
  fetch + window/document exactly as `frontend/tests/chat-sync.test.ts`
  and `frontend/tests/initial-session.test.ts` do). Synthetic fixtures
  only.
- Astryx primitives only. For each control, verify the disabled prop in
  `dist/*.d.ts` first; where none exists, use an early-return click
  guard with zero visual change (spec §4). Never restyle a primitive to
  "look disabled".
- Reads stay render-direct (same pattern as the existing
  `listCustomChats()` reads); no new context, event bus, or effect
  chain. The gate is a pure predicate over the four existing signals.
- Work on branch `feat/app-ready-gate` (create once with `git checkout
  -b` from current main). Never touch main. Do not commit, push, or
  reset files. Max five touched source files — split and report if
  exceeded.

## Required working method

Work in order: (1) predicate + chatReady helper + truth-table tests,
(2) Pesdac sidebar + welcome-composer branches, (3) ThreadView skeleton
condition + composer disable, (4) gates. Report after each with:

```text
Task: G_
Evidence observed:
Files inspected:
Files changed:
Acceptance criteria completed:
Commands/tests run:
Failures or warnings:
Next action:
```

If blocked, report the exact blocker and smallest safe options.

## Guardrails

- Predicate is exact spec §3.2–§3.3: `loading` blocks, `error` settles
  (fail open), guests lift on the guest proof, stale identity keys are
  not ready. No extra states, no timeouts, no retries.
- `!U` blocks everything in the matrix — including surfaces that feel
  "safe" (demo rows, New chat, search). The loading window is the hazard.
- Skeleton swaps hold layout: fixed heights/widths measured against the
  live render. If a height can't be matched without restyling, report
  instead of reflowing.
- Disabling never clears input: `welcomeText`, per-thread drafts, and
  staged attachments survive the gate in both directions.
- `U && !C` must be provably behavior-identical to today outside the
  chat rows (no drive-by refactors; guest path byte-identical as in
  wave 2).
- 401s anywhere → existing global flow; no extra error UI.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`,
`npm.cmd run build`. From repo root: `git diff --check`, `git status --short`.
Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- §4 matrix fully implemented; `!U && C` still skeletons chats (predicate
  test + reasoning over the render branch).
- New tests: predicate truth table (loading blocks / error settles /
  guest lifts / stale key not ready) + chatReady around hydrate states.
  Existing suites pass unmodified.
- Full gates green; backend untouched (prove via `git status --short`).
- Astryx UI/copy/layout unchanged apart from the specified skeleton +
  disabled states; desktop + narrow; clean console.
- Browser matrix is the LEAD's job at merge — but list the routes/clicks
  you used for any manual checks you did.
- Final report: files changed + why, test results, any spec-defect
  reports, any collision with another run's edits.
