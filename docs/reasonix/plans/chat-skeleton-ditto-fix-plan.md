# Plan: chat skeleton ditto fix (single stream)

Spec: `docs/reasonix/specs/chat-skeleton-ditto-fix.md` (FROZEN — the stream builds against it; defects become reports, never unilateral edits).
Status: Proposed.
Branch rule: one branch from main; never commit to main; do not push/commit unless the user explicitly asks.

## Stream (one — small by design)

| Stream | Branch | Owns (ONLY these) | Must NEVER touch |
|---|---|---|---|
| Ditto fix | `feat/chat-skeleton-ditto-fix` | `frontend/src/components/chat/ChatListSkeleton.tsx` (rewrite row), `frontend/src/components/chat/ComposerSkeleton.tsx` (rewrite card + props), `frontend/src/components/Pesdac.tsx` (Subjects VStack block + welcome composer swap + imports only) | `session.ts`, `ThreadView.tsx`, `chat-sync.ts`, `lib/chat.ts`, anything under `backend/`, theme, global CSS, any other component, any test file |

Rationale for a single stream: state/predicates already landed (stream A). This is two presentational rewrites over one shared `skeletonRows` var plus two render-branch moves in the same file (`Pesdac.tsx`). Splitting it would manufacture a merge conflict in `Pesdac.tsx` for no parallelism gain. Medium effort, one session.

## Build order (inside the stream)

1. `ChatListSkeleton.tsx`: drop the leading `20×20` icon (real Subjects rows have none), keep label `140×14 radius={1}` + trailing `16×16` menu-width reserve, `VStack gap={0.5}`, aria props, `index` stagger. Verify against `Pesdac.tsx:450-504` (hover-only `MoreMenu`) before editing.
2. `ComposerSkeleton.tsx`: add aria props to the signature (fixes `Pesdac.tsx:1738` type error), then rebuild slots to mirror `ChatComposer.tsx:146-220` (header 28px, input placeholder, footer 32px, card padding/radius). Verify sizes against `Pesdac.tsx:1740-1891` (Attach/Reference `size="sm"`, Auto/Settings `size="md"`, send `32px`).
3. `Pesdac.tsx`: delete section-level `rows={2}` sibling block; rewire workspace/Pinned/Archived `VStack`s to `skeletonRows`; keep `!isUserReady` paint-only composer swap. Confirm `git diff` is confined to the owned blocks + imports.
4. Gates.

## My merge procedure (lead reviewer = me)

1. Cut `feat/chat-skeleton-ditto-fix` from current `main`.
2. Land the stream; re-run full gates on the merge: frontend `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`, `git diff --check` from repo root.
3. User-assisted browser matrix:
   - F1: authed refresh with customs under CN + DLCD → indented skeleton rows inside the right collapsibles → real names, no shift, no top-level block
   - F2: cold `/new` with slow user data → rounded composer-card skeleton (header/input/footer in Image 1 slots) → real composer, drafts survive, toggles/cards disabled
   - F3: guest + demo + ready-empty: zero skeletons, zero fetches
   - F4: forced hydrate failure → memory + one toast each
   - Narrow viewport (<=640px), clean console, no 504s

## File touch budget

- Max five touched source files (expected: three). Exceeding it means the stream was mis-scoped — split and report.

## Risks

- `workspaceCustoms.length` cold-`0` trap: bounded by the FR1 rule — always use the existing `skeletonRows` clamp, never per-workspace length; any other count source stops and reports.
- Leading-icon temptation (re-adding `20×20` to "match Pinned"): forbidden for Subjects rows — real custom/demo rows pass no icon; the reserve that matters is the trailing menu width.
- Full-area composer skeleton (one big block over the whole welcome): forbidden — header/input/footer must skeleton independently inside the card geometry.
- `aria-busy` prop error recurrence: bounded by the FR3 signature — `ComposerSkeleton` must accept and forward the aria props `Pesdac.tsx` already passes.
- Hydration mismatch: no `typeof window`, no random values in either skeleton component.
- A concurrent run editing `Pesdac.tsx` (happened during wave 2): the prompt carries the courtesy rule — `git status --short` first, touch only owned blocks, report collisions instead of overwriting.
