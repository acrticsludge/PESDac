# Muse Spark implementation prompt: settings S4 — locale persist + timestamp helper (single stream)

You are Muse Spark 1.3, running on medium reasoning, implementing in the
PESDac repository. Read these first, in order:

- `AGENTS.md` (Astryx mandatory, smallest diff — three `onChange` lines + one
  new helper file; no call-site rewiring, no layout changes)
- `docs/reasonix/specs/spec-locale.md` (FROZEN — defects become reports, never
  unilateral spec edits; this stream covers persistence + application layer 1
  helper ONLY, no call sites)
- `docs/reasonix/plans/settings-parallel-plan.md` (your stream is S4; ownership
  table + frozen kernel API + Step-0 prerequisite)

## Skills to utilize (invoke as the work demands)

- **test-driven-development** — RED repro before every behavior (persist
  round-trip; Intl helper output under two locales; unknown-value fallback).
- **incremental-implementation** — order: (1) persist + tests, (2) helper +
  tests. Green between slices. (Call-site adoption is an explicit follow-up —
  not this stream.)
- **api-and-interface-design** — helper signature frozen by you, documented in
  the file: pure `(isoString, { region, timeZone }) => string`, never throws,
  falls back to built-ins on unknown values.
- **frontend-ui-engineering** — no UI beyond the three existing rows; helper
  has no UI surface.
- **security-and-hardening** — guests memory-only, zero fetches; unknown locale
  values fail closed to built-ins (mirror the `isCampus` read-guard pattern),
  never a crash or blank.
- **debugging-and-error-recovery** — reproduce before fixing; never weaken tests.
  (`Intl` with `timeZone` option is deterministic — pass explicit zones in
  tests, never depend on the machine zone.)
- **code-simplification** — three lines + one small pure module + tests.
- **code-review-and-quality** — self-review the final diff on all five axes
  before writing the final report.

Key source files (open before editing):

- `frontend/src/components/profile/sections.tsx` (**LanguageSection ONLY**):
  language, region, timezone `onChange`s → one line each to `savePreference`.
  The `toast` line is pre-placed by Step 0. Touch no other row, no other section.
- `frontend/src/lib/session.ts`, `frontend/src/lib/settings-scope.ts`
  (CALL the kernel — never edit; locale needs no overrides, global-only by design).

Before touching code, run `git status --short` (anything modified/untracked
outside your owned paths belongs to another run — do not touch it) and verify
Step 0 (grep `getScopeOverride` in `session.ts` + `settings-scope.ts` exists).
If absent, STOP and report. Work on branch `feat/setting-locale` (create once).
Never touch main. Do not commit, push, or reset files.

## Mission

Persist language + region + time zone server-side (existing validated PATCH
contract — frontend lists and backend tuples already match 1:1) and add the
pure `Intl`-based timestamp formatter the spec's layer 1 calls for. No call-site
rewiring, no i18n catalog, no RTL (explicit follow-ups).

## Hard constraints

- Touch ONLY: the three `onChange` lines, `frontend/src/lib/format-timestamps.ts`
  (new), `frontend/tests/setting-locale.test.ts` (new). NEVER edit another
  stream's rows, existing tests, `ThreadView.tsx`, `auth.ts`, `chat-sync.ts`,
  `Pesdac.tsx`, `backend/`, theme, toast copy, Phase-1–5 semantics.
- UI copy language unchanged (layer 3 explicitly not started).
  `git diff --check` clean.
- Kernel call shape: `savePreference(patch, toast, { server: auth.status === "authenticated" })`
  (`toast` is pre-placed; add `useAuth()` if the section lacks it). The `{ server }`
  flag is required — a missing flag is a check error, never a silent guest fetch.

## Acceptance checklist

- Locale triple survives logout/login (PATCH round-trip in stubbed test).
- Fixed timestamp renders differently under `IN/IST` vs `US/ET` (helper test
  with explicit zones); unknown values fall back to built-ins without throwing.
- Guest costs zero fetches. Full gates green; diff confined to owned paths.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`.
From repo root: `git diff --check`, `git status --short`. Paste exact failures;
never weaken tests to pass.

## Final report (after the last gate — this exact shape)

```text
Task: S4-locale (complete)
Files changed: <list + one line each on why>
Acceptance criteria completed: <each, with the test name that locks it>
Commands/tests run: <exact commands + counts>
Failures or warnings: <exact text or "none">
Merge-readiness: <ready / blocked-on: ...>
```
