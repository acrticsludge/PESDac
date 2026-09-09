# Plan: app readiness gate (single stream)

Shared contract: `docs/reasonix/specs/app-ready-gate.md` (FROZEN — the
stream builds against it; defects become reports, never unilateral
edits).
Status: Proposed.

## Stream (one — small by design)

| Stream | Branch | Owns (ONLY these) | Must NEVER touch |
|---|---|---|---|
| Gate | `feat/app-ready-gate` | `frontend/src/lib/session.ts` (predicate + chatReady helper only), `frontend/src/components/Pesdac.tsx`, `frontend/src/components/chat/ThreadView.tsx`, `frontend/tests/app-ready-gate.test.ts` (new) | `chat-sync.ts`, anything under `backend/`, theme, global CSS, any other component |

Rationale for a single stream: the work is three render branches over one
predicate plus its tests. Splitting it would manufacture merge conflicts
in `Pesdac.tsx` for no parallelism gain. Medium effort, one session.

## Build order (inside the stream)

1. Predicate + helper in `session.ts` (`userReady(auth, profile, seed)`,
   `chatReady(auth, hydratedKey)`) with the truth-table tests first
   (fail → implement → pass).
2. `Pesdac.tsx`: sidebar skeleton/disabled branches + welcome-composer
   skeleton swap. Verify each primitive's disabled prop in
   `node_modules/@astryxdesign/core/dist` before use; click-guard
   fallback where none exists (spec §4).
3. `ThreadView.tsx`: extend the existing skeleton-branch condition with
   `!userReady`; `isDisabled` the thread composer + menus while gated.
4. Gates.

## My merge procedure (lead reviewer = me)

1. Cut `feat/app-ready-gate` from current `main` (contains wave 2).
2. Land the stream; re-run full gates on the merge: frontend
   `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`,
   `git diff --check` from repo root.
3. User-assisted browser matrix: cold guest load (no perceptible block),
   throttled authed load (gate holds through seed, zero dead clicks),
   `!U && C` chat skeletons, `U && !C` chat-only skeleton, no reflow on
   swaps, drafts preserved, narrow viewport, clean console.

## Risks

- Disabled-prop gaps (ToggleButton, ClickableCard, menu buttons): bounded
  by the click-guard fallback rule — a missing prop never blocks the
  stream.
- Skeleton heights mismatch the live composer/rows (reflow): fixed by
  measuring against the live render, not by restyling it.
- A concurrent run editing `Pesdac.tsx`/`ThreadView.tsx` (happened during
  wave 2): the prompt carries the courtesy rule — `git status --short`
  first, touch only owned files, report collisions instead of
  overwriting.
- Gate flapping on identity transitions (logout→login): accepted — the
  windows are brief and blocking there is correct, not a bug.
