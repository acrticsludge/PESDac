# Muse Spark implementation prompt: settings S1 — follow-up suggestions (single stream)

You are Muse Spark 1.3, running on medium reasoning, implementing in the
PESDac repository. Read these first, in order:

- `AGENTS.md` (Astryx mandatory, smallest diff, no redesign — thread-menu entry
  only, no layout/component changes)
- `docs/reasonix/specs/spec-followup-suggestions.md` (FROZEN — defects become
  reports, never unilateral spec edits)
- `docs/reasonix/plans/settings-parallel-plan.md` (your stream is S1; ownership
  table + frozen kernel API + Step-0 prerequisite)

## Skills to utilize (invoke as the work demands)

- **test-driven-development** — RED repro before every behavior (gate respects
  override; global persists; reset clears). No test, no implementation.
- **incremental-implementation** — order: (1) resolver + tests, (2) global
  persist + tests, (3) menu entry + gate + tests. Green between slices.
- **api-and-interface-design** — `resolveFollowUps` keeps the frozen kernel
  shapes; no new cross-module contracts.
- **frontend-ui-engineering** — Astryx-only menu entry; production-quality,
  accessible, no custom chrome.
- **security-and-hardening** — guest path performs zero fetches; override map
  is identity-scoped and dies on transition (kernel does this — verify, don't
  reimplement).
- **debugging-and-error-recovery** — if a gate test fails, reproduce first,
  fix root cause, never weaken the test.
- **code-simplification** — smallest diff that satisfies acceptance; no
  speculative generality.
- **code-review-and-quality** — self-review the final diff on all five axes
  before writing the final report.

Key source files (open before editing):

- `frontend/src/components/chat/ThreadView.tsx:1837-1858` (Conversation-actions
  menu — append ONE item after the Copy-transcript item; this array is YOURS,
  no other stream touches it), `:834-838` + `:1960-1973` (pill render gate)
- `frontend/src/components/profile/sections.tsx` (AssistantSection follow-ups
  row `onChange` ONLY — one line; the `toast` line is pre-placed by Step 0)
- `frontend/src/lib/session.ts` (`getScopeOverride`/`setScopeOverride`/`scopeKey`
  — CALL, never edit), `frontend/src/lib/settings-scope.ts`
  (`resolveTiered`, `savePreference` — CALL, never edit)

Before touching code, run `git status --short` (Step-0 files excepted, anything
else modified/untracked belongs to another run — do not touch it) and verify
Step 0: grep `getScopeOverride` in `session.ts` and confirm
`frontend/src/lib/settings-scope.ts` exists. If absent, STOP and report — do not
reimplement the kernel. Work on branch `feat/setting-followups` (create once
with `git checkout -b`). Never touch main. Do not commit, push, or reset files.

## Mission

Make the Follow-up suggestions toggle real and compartmental: global default
persists server-side; per-chat override (On / Off / Use default) in the thread
menu; render gate respects `resolveFollowUps`.

## Hard constraints

- Touch ONLY: the Conversation-actions `items` array (+ gate lines),
  the follow-ups row `onChange`, `frontend/src/lib/setting-followups.ts` (new:
  `resolveFollowUps(chatCode: string | null): boolean` via kernel),
  `frontend/tests/setting-followups.test.ts` (new). NEVER edit another stream's
  rows, existing tests, `auth.ts`, `chat-sync.ts`, `Pesdac.tsx`, `backend/`,
  theme, toast copy, Phase-1–5 semantics.
- Global persist = `savePreference({ followUps }, toast, { server: auth.status === "authenticated" })`
  (rollback + toast come free; read `auth` from the existing `useAuth()` —
  add it if the menu component lacks it). Per-chat override = kernel map (`setting="followUps"`,
  `scopeKey("chat", code)`); "Use default" deletes the entry.
- Gate: pills render iff `resolveFollowUps(code)`; guests memory-only, zero
  fetches. `git diff --check` clean.

## Acceptance checklist

- Global off → no pills anywhere without an override; per-chat On re-enables in
  exactly that chat; per-chat Off suppresses; "Use default" deletes the entry.
- Global survives logout/login (PATCH round-trip in stubbed test).
- Guest toggle costs zero fetches; identity transition clears overrides.
- Full gates green (`npm.cmd test`, `npm.cmd run astro -- check`,
  `npm.cmd run build`, `git diff --check`); diff confined to owned paths.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`.
From repo root: `git diff --check`, `git status --short`. Paste exact failures;
never weaken tests to pass.

## Final report (after the last gate — this exact shape)

```text
Task: S1-followups (complete)
Files changed: <list + one line each on why>
Acceptance criteria completed: <each, with the test name that locks it>
Commands/tests run: <exact commands + counts>
Failures or warnings: <exact text or "none">
Merge-readiness: <ready / blocked-on: ...>
```
