# Muse Spark implementation prompt: caching Phase 2 — resolve guards (single stream)

You are Muse Spark 1.3, running on medium reasoning, implementing in the
PESDac repository. Read these first, in order:

- `AGENTS.md` (no redesign, no theme/CSS changes, smallest diff; no UI touched)
- `docs/reasonix/specs/caching-audit.md` (§2 principles 2+4 + §4 P1-4/P1-5/P1-6
  + P0-3 residual + §5 Fix 2; FROZEN — defects become reports, never
  unilateral spec edits)
- `docs/reasonix/plans/caching-plan.md` (Phase 2 is your ONLY scope; Phase 1
  reset assumed merged — verify `resetChatStoreForIdentity()` exists before
  starting; if absent, stop and report)

Key source files (open before editing):

- `frontend/src/lib/session.ts:1109-1152` (`loadChatMessages`; resolve path
  `:1126-1134`, wholesale `setOverlay :1130`, failure `:1136-1150`),
  `:750-755` (`setOverlay`), `:901-933` (`renameChatBacked`: snapshot `:913`,
  reconcile `:917-925`, rollback `:928-929`), `:956-1001` (`setPinBacked`:
  prev `:967`, rollback `:989-993`), `:1003-1060` (`setArchivedBacked`:
  prev `:1015`, rollback `:1048-1051`)
- `frontend/src/lib/auth.ts:1130-1136` (`mintBackendTokenWithRetry` cache
  write — add epoch guard)
- `frontend/src/components/chat/ThreadView.tsx:1103-1114` (edit snapshot
  restore), `:1173-1184` (send persist loop) — read-only context, do NOT edit
- `frontend/tests/cache-identity-reset.test.ts` (Phase 1 pins — keep green,
  extend nothing in it; new tests go in your own file)

Before touching code, run `git status --short`. Existing modified/untracked
files belong to the user or another run. Do not reset, clean, checkout,
overwrite, or commit them. Work on branch `fix/cache-resolve-guards`
(create once with `git checkout -b`). Never touch main. Do not commit,
push, or reset files.

## Mission

Concurrent and cross-identity async resolves paint stale state: renames
resolve out of order (last-resolver-wins), a late failure resurrects a
deleted chat, a slow history load wipes a just-sent message, and the token
mint can cache across an epoch change. Guard every resolve: drop unless the
identity is still current AND the entity still exists; reconcile by
`updatedAt`, never blind overwrite.

## Hard constraints

- Touch ONLY: `session.ts` (load/message resolve guard + container-op
  reconcile guards), `auth.ts` (mint-write epoch guard — capture epoch at
  mint start, drop cache write on mismatch), plus
  `frontend/tests/cache-resolve-guards.test.ts` (new). NEVER edit
  `chat-sync.ts`, `ThreadView.tsx`, `Pesdac.tsx`, Phase-1 reset semantics,
  `backend/`, theme, toast bridge/copy.
- TDD mandatory (Prove-It per guard): RED repro → fails → minimal GREEN.
  NEVER weaken existing tests (all Phase-1 + 197 prior stay green).
- Load guard: capture `identityKey` (+ overlay marker) at dispatch; on
  resolve, drop unless identity still current AND code still in store; MERGE
  with post-dispatch appends — never wholesale-clobber (P1-6).
- Op guards: reconcile server row only if no newer local intent
  (`updatedAt` compare — P1-5 last-intent-wins); membership check BEFORE any
  rollback (P1-4: delete-then-rename-404 keeps the chat gone, rename returns
  false). Rename per-row snapshot stays Phase 3 — here only add the guards.
- No timers, no retries, no polling, no `typeof window` additions.
  `git diff --check` clean.

## Required working method

Work in order: (1) load/message guard, (2) rename/pin/archive guards,
(3) mint epoch guard, (4) gates. Report after each with:

```text
Task: step_
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

- One thing per step; compilable + tests green between steps.
- Merge-not-clobber is load-bearing: the sent-turn-survives test must fail
  on wholesale `setOverlay` and pass on merge.
- No Phase-3 work (rename per-row snapshot), no Phase-4 work (revalidation),
  no backend work — note smuggling temptations instead of implementing.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`,
`npm.cmd run build`. From repo root: `git diff --check`,
`git status --short`. Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Two deferred renames resolved in reverse end at last intent (paint +
  stored row agree with user order).
- Rename-inflight → delete-ok → rename-404 → chat stays gone, rename
  returns false.
- Append-to-overlay between load dispatch and resolve → sent block survives
  merge; server truth and paint agree.
- Mint started in epoch N resolving in epoch N+1 → cache write dropped, new
  mint issued on next call.
- Full gates green; diff confined to owned files.
- Final report: files changed + why, test results.
