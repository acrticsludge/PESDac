# Muse Spark implementation prompt: settings S2 — study context + quiz config (single stream)

You are Muse Spark 1.3, running on medium reasoning, implementing in the
PESDac repository. Read these first, in order:

- `AGENTS.md` (Astryx mandatory, smallest diff — StudySection rows only, no
  layout/component changes)
- `docs/reasonix/specs/spec-study-context.md` + `docs/reasonix/specs/spec-quiz-customization.md`
  (both FROZEN — defects become reports, never unilateral spec edits)
- `docs/reasonix/plans/settings-parallel-plan.md` (your stream is S2; ownership
  table + frozen kernel API + Step-0 prerequisite)

## Skills to utilize (invoke as the work demands)

- **test-driven-development** — RED repro before every behavior (persist
  round-trip; resolve-table for every tier combination; reset clears).
- **incremental-implementation** — order: (1) study persist + tests,
  (2) quiz resolver + tests, (3) format/subject rows + tests. Green between slices.
- **api-and-interface-design** — `QuizConfig` shape exactly per spec §3;
  resolvers reuse the frozen kernel; no new cross-module contracts.
- **frontend-ui-engineering** — Astryx-only rows (`SegmentedControl`,
  `Selector`, `TextInput` — all already imported in `sections.tsx`); no new
  imports unless the row demands it.
- **security-and-hardening** — server-validated enums mirrored; guests
  memory-only, zero fetches; overrides die on transition.
- **debugging-and-error-recovery** — reproduce before fixing; never weaken tests.
- **code-simplification** — smallest diff per row; no speculative generality
  (no engine, no scoring, no per-chat panel — v2).
- **code-review-and-quality** — self-review the final diff on all five axes
  before writing the final report.

Key source files (open before editing):

- `frontend/src/components/profile/sections.tsx` (**StudySection ONLY**):
  examMonth `onChange` (~649), weeklyGoal `onChange` (~662), difficulty
  `onChange` (~683) → `savePreference`; format-block insert anchored AFTER the
  difficulty row block; subject-exam row insert anchored AFTER the weekly-goal
  row block. The `toast` line is pre-placed by Step 0. Touch no other row,
  no other section.
- `frontend/src/lib/session.ts`, `frontend/src/lib/settings-scope.ts`
  (CALL the kernel — `getScopeOverride`/`setScopeOverride`/`scopeKey`,
  `resolveTiered`, `savePreference` — never edit).

Before touching code, run `git status --short` (anything modified/untracked
outside your owned paths belongs to another run — do not touch it) and verify
Step 0 (grep `getScopeOverride` in `session.ts` + `settings-scope.ts` exists).
If absent, STOP and report. Work on branch `feat/setting-study-quiz` (create
once). Never touch main. Do not commit, push, or reset files.

## Mission

Persist study globals server-side (examMonth, weeklyGoal, difficulty via the
existing validated PATCH contract) and ship the compartmental quiz machinery:
`QuizConfig` + `resolveQuizConfig` (per-chat > per-subject > global), format /
option-count / question-count rows writing the kernel override map, per-subject
exam-date row. No question generation, no scoring, no per-chat panel (v2).

## Hard constraints

- Touch ONLY: the StudySection rows/anchors above, `frontend/src/lib/setting-quiz.ts`
  (new: `QuizConfig` type exactly per spec + `resolveQuizConfig`),
  `frontend/src/lib/setting-study.ts` (new: `resolveExamMonth`/`resolveWeeklyGoal`),
  `frontend/tests/setting-study-quiz.test.ts` (new). NEVER edit another stream's
  rows, existing tests, `ThreadView.tsx`, `auth.ts`, `chat-sync.ts`, `Pesdac.tsx`,
  `backend/`, theme, toast copy, Phase-1–5 semantics.
- Override setting names (frozen): `difficulty`, `format`, `optionCount`,
  `questionCount`, `examMonth`. `weeklyGoal` stays global-only by design (no
  override tiers). The proactive row lives in AssistantSection (not your region)
  — leave it untouched; the quiz engine phase owns it.
- `optionCount` int 2–6; `format` single|multi; memory-only (zero fetches),
  identity-scoped. `git diff --check` clean.
- Kernel call shape: `savePreference(patch, toast, { server: auth.status === "authenticated" })`
  (`toast` is pre-placed; add `useAuth()` if the section lacks it). The `{ server }`
  flag is required — a missing flag is a check error, never a silent guest fetch.

## Acceptance checklist

- Globals (examMonth, weeklyGoal, difficulty) survive logout/login (PATCH
  round-trip in stubbed test).
- Resolve-table: every unset/set combination across tiers returns the nearest
  set value; per-subject exam date resolves only for that subject; reset
  restores inheritance; transition clears overrides; guest costs zero fetches.
- Full gates green; diff confined to owned paths.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`.
From repo root: `git diff --check`, `git status --short`. Paste exact failures;
never weaken tests to pass.

## Final report (after the last gate — this exact shape)

```text
Task: S2-study-quiz (complete)
Files changed: <list + one line each on why>
Acceptance criteria completed: <each, with the test name that locks it>
Commands/tests run: <exact commands + counts>
Failures or warnings: <exact text or "none">
Merge-readiness: <ready / blocked-on: ...>
```
