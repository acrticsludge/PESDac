# Muse Spark implementation prompt: caching Phase 3 — per-row rollback + complete hydration (single stream)

You are Muse Spark 1.3, running on medium reasoning, implementing in the
PESDac repository. Read these first, in order:

- `AGENTS.md` (no redesign, no theme/CSS changes, smallest diff; no UI touched)
- `docs/reasonix/specs/caching-audit.md` (§2 principles 3+5 + §4 P1-3/P1-7 +
  §5 Fix 3; FROZEN — defects become reports, never unilateral spec edits)
- `docs/reasonix/plans/caching-plan.md` (Phase 3 is your ONLY scope; Phases
  1–2 assumed merged — verify reset + guards exist before starting; if
  absent, stop and report)

Key source files (open before editing):

- `frontend/src/lib/session.ts:901-933` (`renameChatBacked` whole-list
  snapshot `:913` / restore `:928` — the P1-3 site; make per-row like
  pin `:989-992` / archive `:1048-1051`), `:1269-1314` (`hydrateChats`;
  bare `apiListChats() :1283`, pending merge `:1301-1302`),
  `:1109-1152` (`loadChatMessages`; bare `apiListMessages :1126`),
  `:851-871` (`messageToBlock`)
- `frontend/src/lib/chat-sync.ts:34-53` (envelope + tail-window spec
  comment), `:86-97` (`apiListChatsPage`), `:143-149`
  (`apiListMessagesPage`) — existing helpers you CALL; contracts and
  envelope shapes are frozen, do not alter
- `backend/app/routers/chats.py:136-155` (`GET /chats`: `limit=50`,
  `archived=false` defaults), `:283-299` (`GET messages`: `limit=200`,
  `seq ASC`) — read-only context, do NOT edit backend in this phase

Before touching code, run `git status --short`. Existing modified/untracked
files belong to the user or another run. Do not reset, clean, checkout,
overwrite, or commit them. Work on branch `fix/cache-rollback-paging`
(create once with `git checkout -b`). Never touch main. Do not commit,
push, or reset files.

## Mission

Two completeness defects: (a) rename failure restores the entire list,
wiping concurrent confirmed ops on other chats; (b) hydration treats page 1
as truth — >50 chats, archived rows, and >200-turn tails silently vanish
with `ready` set. Make rollback per-row and hydration complete (or
explicitly incomplete).

## Hard constraints

- Touch ONLY: `session.ts` (rename per-row snapshot/restore; hydrate +
  message-load page loops via existing `*Page` helpers), plus
  `frontend/tests/cache-rollback-paging.test.ts` (new). NEVER edit
  `chat-sync.ts` contracts, `backend/`, `ThreadView.tsx`, `Pesdac.tsx`,
  theme, toast bridge/copy, Phase-1/2 semantics.
- TDD mandatory (Prove-It per defect): RED repro → fails → minimal GREEN.
  NEVER weaken existing tests.
- Rollback: snapshot/restore the affected row only (pin/archive pattern).
  Phase-2 membership + `updatedAt` guards stay intact around it.
- Paging: hydrate requests archived rows explicitly and follows
  `pagination.total` past `limit=50` (page loop, still fetch-once-per-
  identity); thread load uses the tail window (`limit=50,
  offset=max(0,total-50)` per `chat-sync.ts:49`) so newest turns show. If
  full paging is deferred for any leg, refuse `ready` while truncated and
  surface the existing error affordance — never a false-complete list.
- No timers, no retries, no polling, no new query helpers.
  `git diff --check` clean.

## Required working method

Work in order: (1) rename per-row rollback, (2) hydrate paging (incl.
archived), (3) message tail window, (4) gates. Report after each with:

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
- Archived-row handling is load-bearing: excluded-from-`serverCodes` rows
  must migrate flags, not silently drop `c:` intent.
- No Phase-4 work (revalidation hooks), no Phase-5 work (backend) — note
  instead of implementing.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`,
`npm.cmd run build`. From repo root: `git diff --check`,
`git status --short`. Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Rename-fail with concurrent pin-success on another chat → pin survives,
  renamed row restored exactly.
- Stub `total: 73` (+ archived rows) → all 73 hydrate, archived listed with
  flags migrated; nothing silently dropped.
- Stub 250-turn thread → newest turns visible (tail window), no
  false-complete `ready`.
- Any leg that cannot complete paging → `ready` refused + existing error
  affordance (not a truncated list painted as truth).
- Full gates green; diff confined to owned files.
- Final report: files changed + why, test results.
