# Muse Spark implementation prompt: settings S3 — answer shaping (single stream)

You are Muse Spark 1.3, running on medium reasoning, implementing in the
PESDac repository. Read these first, in order:

- `AGENTS.md` (Astryx mandatory, smallest diff — two `onChange` lines only)
- `docs/reasonix/specs/spec-answer-shaping.md` (FROZEN — defects become reports,
  never unilateral spec edits)
- `docs/reasonix/plans/settings-parallel-plan.md` (your stream is S3; ownership
  table + frozen kernel API + Step-0 prerequisite)

## Skills to utilize (invoke as the work demands)

- **test-driven-development** — RED repro before every behavior (persist
  round-trip; per-chat resolve; reset clears). No test, no implementation.
- **incremental-implementation** — order: (1) global persist + tests,
  (2) resolver + tests. Green between slices. (No panel in v1 — override API
  only; panel is v2.)
- **api-and-interface-design** — `resolveAnswerStyle` keeps frozen kernel
  shapes; no new cross-module contracts.
- **frontend-ui-engineering** — no UI beyond the two existing rows; nothing
  custom, nothing new.
- **security-and-hardening** — guests memory-only, zero fetches; overrides die
  on transition; server enums reject unknown values (existing validators).
- **debugging-and-error-recovery** — reproduce before fixing; never weaken tests.
- **code-simplification** — two lines + one tiny module + tests; nothing more.
- **code-review-and-quality** — self-review the final diff on all five axes
  before writing the final report.

Key source files (open before editing):

- `frontend/src/components/profile/sections.tsx` (**AssistantSection ONLY**):
  verbosity `onChange` (~754) and citations `onChange` (~774) → one line each
  to `savePreference`. The `toast` line is pre-placed by Step 0. Touch no other
  row (follow-ups belongs to S1), no other section.
- `frontend/src/lib/session.ts`, `frontend/src/lib/settings-scope.ts`
  (CALL the kernel — never edit).

Before touching code, run `git status --short` (anything modified/untracked
outside your owned paths belongs to another run — do not touch it) and verify
Step 0 (grep `getScopeOverride` in `session.ts` + `settings-scope.ts` exists).
If absent, STOP and report. Work on branch `feat/setting-shaping` (create once).
Never touch main. Do not commit, push, or reset files.

## Mission

Persist verbosity + citations server-side (existing validated PATCH contract) and
ship the compartmental machinery: `resolveAnswerStyle({ chatCode })` (per-chat >
global) over the kernel override map, so the backend/AI phase can bind it with
zero rework. Setting an override changes no current behavior (nothing consumes
these fields yet) — ship persistence + resolver + tests.

## Hard constraints

- Touch ONLY: the two `onChange` lines, `frontend/src/lib/setting-shaping.ts`
  (new: `resolveAnswerStyle`), `frontend/tests/setting-shaping.test.ts` (new).
  NEVER edit another stream's rows, existing tests, `ThreadView.tsx`, `auth.ts`,
  `chat-sync.ts`, `Pesdac.tsx`, `backend/`, theme, toast copy, Phase-1–5 semantics.
- Override setting names (frozen): `verbosity`, `citations`. No per-subject tier
  in v1 (reserved, not built). `git diff --check` clean.
- Kernel call shape: `savePreference(patch, toast, { server: auth.status === "authenticated" })`
  (`toast` is pre-placed; add `useAuth()` if the section lacks it). The `{ server }`
  flag is required — a missing flag is a check error, never a silent guest fetch.

## Acceptance checklist

- Globals survive logout/login (PATCH round-trip in stubbed test).
- Per-chat override resolves only in that chat; reset restores inheritance;
  transition clears; guest costs zero fetches.
- Zero behavior change to current answers (suite green, send path untouched).
- Full gates green; diff confined to owned paths.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`.
From repo root: `git diff --check`, `git status --short`. Paste exact failures;
never weaken tests to pass.

## Final report (after the last gate — this exact shape)

```text
Task: S3-shaping (complete)
Files changed: <list + one line each on why>
Acceptance criteria completed: <each, with the test name that locks it>
Commands/tests run: <exact commands + counts>
Failures or warnings: <exact text or "none">
Merge-readiness: <ready / blocked-on: ...>
```
