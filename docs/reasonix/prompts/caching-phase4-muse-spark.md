# Muse Spark implementation prompt: caching Phase 4 — foreground revalidation (single stream)

You are Muse Spark 1.3, running on medium reasoning, implementing in the
PESDac repository. Read these first, in order:

- `AGENTS.md` (no redesign, no theme/CSS changes, smallest diff; no UI
  touched — this stream adds listeners only)
- `docs/reasonix/specs/caching-audit.md` (§2 principle 6 + §4 P1-8/P1-9 +
  §5 Fix 4 + §10.3 locked decision; FROZEN — defects become reports, never
  unilateral spec edits)
- `docs/reasonix/plans/caching-plan.md` (Phase 4 is your ONLY scope; Phases
  1–3 assumed merged — verify reset + guards + paging exist before starting;
  if absent, stop and report)

Key source files (open before editing):

- `frontend/src/lib/session.ts:1269-1314` (`hydrateChats` — the refetch
  entry), `:655-661` (`chatReady` gate), `:760-801` (hydrate markers),
  `:1109-1152` (`loadChatMessages` — open-thread refetch entry)
- `frontend/src/lib/auth.ts:167-187` (`authEpoch`), `:317-366` (`useAuth` —
  live session ownership stays; your hook only triggers re-proof)
- `frontend/src/components/Pesdac.tsx:600-620` (hydrate effect + guards —
  read-only context; extend only if the hook needs a trigger point, smallest
  possible wiring, do NOT restructure)
- `frontend/src/lib/session.ts:52-54` (cross-tab sync noted dead — your
  logout ping revives exactly one bit: logout happened)

Before touching code, run `git status --short`. Existing modified/untracked
files belong to the user or another run. Do not reset, clean, checkout,
overwrite, or commit them. Work on branch `feat/cache-revalidation`
(create once with `git checkout -b`). Never touch main. Do not commit,
push, or reset files.

## Mission

Within one identity nothing ever revalidates: other-device edits never
arrive and bfcache restores logged-out paint. Add foreground-gated
revalidation — `pageshow` re-proves the session before rows paint,
foreground refetch (60 s coalesce floor) refreshes hydrate + open thread,
and a logout-only `storage` ping drops sibling-tab caches immediately.

## Hard constraints

- Touch ONLY: one new hook/module for the foreground/pageshow listeners +
  minimal trigger wiring, `session.ts` ONLY to expose a safe refetch entry
  (reuse `hydrateChats`/`loadChatMessages` paths — no duplicate fetch
  logic), plus `frontend/tests/cache-revalidation.test.ts` (new). NEVER edit
  fetch-once semantics outside the hook, `chat-sync.ts`, `backend/`, theme,
  toast bridge/copy, Phase-1–3 semantics.
- TDD mandatory where deterministic (coalesce math, ping handling, refetch
  entry behavior with stubbed fetch): RED → fails → minimal GREEN. NEVER
  weaken existing tests.
- `pageshow` (incl. `persisted=true`) re-proves session BEFORE rows paint —
  fail closed to loading on ambiguity, never a cached paint.
- Foreground refetch: hydrate + open-thread messages only, skipped if last
  fetch <60 s ago (storm guard), skipped entirely while logged out/guest.
- Logout ping: single `localStorage` key written ONLY on logout transitions;
  receivers run the Phase-1 reset (no navigation from the ping).
- NO intervals, NO polling, NO focus-refetch loops, no new background work.
  `git diff --check` clean.

## Required working method

Work in order: (1) logout ping + receiver, (2) pageshow re-proof,
(3) foreground refetch + coalesce, (4) gates. Report after each with:

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
- Listeners must clean up on unmount (no leaked subscriptions across the
  persisted island's lifetime).
- No Phase-5 work (backend), no prefetching, no speculative fetching —
  note instead of implementing.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`,
`npm.cmd run build`. From repo root: `git diff --check`,
`git status --short`. Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Simulated `pageshow persisted=true` with dead session → loading, no
  logged-out rows painted; live session → re-proven then rows.
- Server-side delete + foreground event → deleted chat gone without reload.
- Two foregrounds <60 s apart → exactly one refetch; guest foreground →
  zero fetches.
- Logout ping → sibling-tab equivalent (second store instance) runs reset,
  no navigation triggered.
- Full gates green; diff confined to owned files.
- Final report: files changed + why, test results.
