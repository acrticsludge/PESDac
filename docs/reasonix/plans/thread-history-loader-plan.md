# Plan: thread history loader (single stream)

Spec: `docs/reasonix/specs/thread-history-loader.md` (FROZEN — the stream builds against it; defects become reports, never unilateral edits).
Related: `/mockups` Option B is the approved visual (`frontend/src/components/chat/ThreadLoaderMockups.tsx` `OptionBToolcallChip` — chip props are locked from there verbatim).
Status: Proposed.
Branch rule: one branch from main; never commit to main; do not push/commit unless the user explicitly asks.

## Stream (one — small by design)

| Stream | Branch | Owns (ONLY these) | Must NEVER touch |
|---|---|---|---|
| History loader | `feat/thread-history-loader` | `frontend/src/components/chat/ThreadSkeleton.tsx` (delete), `frontend/src/components/chat/ThreadHistoryLoader.tsx` (new), `frontend/src/components/chat/ThreadView.tsx` (import + one JSX tag only), `frontend/src/components/chat/ThreadLoaderMockups.tsx` (baseline section removal + Option B copy only) | `session.ts`, `chat-sync.ts`, `lib/chat.ts`, `Pesdac.tsx`, anything under `backend/`, theme, global CSS, any test file |

Rationale for a single stream: one presentational swap over one frozen branch condition plus a dev-page cleanup. Splitting would manufacture merge conflicts in `ThreadView.tsx` for no parallelism gain. Small effort, one session.

## Build order (inside the stream)

1. `ThreadHistoryLoader.tsx`: new component per FR1 — copy the wrapper (`VStack gap={4}`, aria props) and assistant shell (avatar, ghost bubble) from the current `ThreadSkeleton`, replacing all three turns with the single running chip using the exact `/mockups` Option B props. Verify against `ChatToolCalls.tsx:46-91` (item shape) and `:419-453` (running renders `Spinner sm` + name + target inline).
2. Delete `ThreadSkeleton.tsx`; rewire `ThreadView.tsx:71` (import) + `:1841-1842` (JSX tag). Confirm the `showHistorySkeleton` condition is byte-identical before/after.
3. `ThreadLoaderMockups.tsx`: remove `ThreadSkeleton` import + baseline section; mark Option B `body` as shipped. Verify no other page references the old name.
4. `grep ThreadSkeleton frontend/src` must be clean (excluding docs/history). Then gates.

## My merge procedure (lead reviewer = me)

1. Cut `feat/thread-history-loader` from current `main`.
2. Land the stream; re-run full gates on the merge: frontend `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`, `git diff --check` from repo root.
3. User-assisted browser matrix:
   - F1: server-chat open/switch + deep-link pending + `!isAppReady` gate (throttled history) → running chip from frame one → real turns, list only grows, composer live
   - F2: guest + demo + ready-empty: zero loaders, zero fetches
   - F3: forced history failure → memory + one toast
   - Reduced-motion + SR spot-check if feasible; narrow viewport (<=640px), clean console, no 504s

## File touch budget

- Max five touched source files (expected: four — one delete, one add, two edits). Exceeding it means the stream was mis-scoped — split and report.

## Risks

- Bar-template nostalgia ("keep 3 turns but smaller"): forbidden — the decision for a single status row was made on `/mockups`; any structural placeholder stops and reports.
- Chip-prop improvisation (renaming to "load"/"fetch"/other targets): forbidden — props are locked verbatim from the approved mockup; copy changes are a new decision, not this stream's.
- Condition "cleanup" (restating `showHistorySkeleton` while touching the branch): forbidden — mechanical tag swap only; the predicate stays frozen in `session.ts` and the condition stays byte-identical in `ThreadView.tsx`.
- Baseline-section rescue ("keep old skeleton for comparison"): forbidden — FR3 removes it; comparison history lives in git, not in the dev page.
- A concurrent run editing `ThreadView.tsx`: the prompt carries the courtesy rule — `git status --short` first, touch only the import + tag lines, report collisions instead of overwriting.
