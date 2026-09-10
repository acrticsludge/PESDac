# Plan: skeleton fidelity fix — pinned loader + thread ditto (two streams)

Spec: `docs/reasonix/specs/skeleton-pinned-thread-fix.md` (FROZEN — streams build against it; defects become reports, never unilateral edits).
Audit: `docs/audits/2026-09-10-skeleton-pinned-thread-audit.md`.
Status: Proposed.
Branch rule: one branch per stream from main; never commit to main; do not push/commit unless the user explicitly asks.

## Stream file-ownership (exclusive — a stream touching another stream's files stops and reports)

| Stream | Branch | Owns (ONLY these) | Must NEVER touch |
|---|---|---|---|
| S1 pinned loader | `feat/skeleton-pinned-loader` | `frontend/src/components/Pesdac.tsx` (snapshot keys + Pinned/Archived section gates + counts only), `frontend/src/components/chat/ChatListSkeleton.tsx` (`withIcon` variant only) | `session.ts`, `ThreadView.tsx`, `ThreadSkeleton.tsx`, `chat-sync.ts`, `lib/chat.ts`, backend, theme, CSS, any test file |
| S2 thread ditto | `feat/skeleton-thread-ditto` | `frontend/src/components/chat/ThreadSkeleton.tsx` (full rewrite) | `Pesdac.tsx`, `session.ts`, `ThreadView.tsx` (consume branch as-is), `chat-sync.ts`, backend, theme, CSS, any test file |

Rationale for two streams: S1 lives in the sidebar (`Pesdac.tsx` + list skeleton); S2 lives in the message list (`ThreadSkeleton.tsx` alone, zero logic change). Disjoint file sets, no merge conflict, parallel-safe. S2 is the smaller of the two.

## Build order

### S1: pinned loader

1. `ChatListSkeleton.tsx`: add optional `withIcon?: boolean` — leading `Skeleton 20×20 radius={2}` (Bookmark `size="sm"` slot) before the existing label bar; default path byte-identical. Verify against `Pesdac.tsx:1649-1658` (only Pinned passes `BookmarkIcon`).
2. `Pesdac.tsx` snapshot block (`845-920`): add `pesdac:lastKnownPinnedCount` / `pesdac:lastKnownArchivedCount` with the FR1 write/read/clamp rules; filter the existing per-subject snapshot to unpinned + unarchived customs via the existing `pinKeys`/`archivedKeys`.
3. `Pesdac.tsx` sections: Pinned gate → `pinnedRows.length > 0 || pinnedSkeletonRows > 0`, skeleton `<ChatListSkeleton rows={pinnedSkeletonRows} withIcon />` on the `showWorkspaceSkeleton` window; Archived same with its own count and no `withIcon`. Confirm `git diff` is confined to the snapshot block + two section blocks + imports.
4. Gates.

### S2: thread ditto

1. `ThreadSkeleton.tsx`: rewrite turns per FR5 against `ThreadView.tsx:1426-1481` (user shell) and `:1483-1570` (assistant shell) — user turn drops the avatar, drops `variant="ghost"`, shortens bars, adds bubble-`metadata` slot; assistant turns keep ghost bubbles, expand `ChatMessageMetadata` to timestamp + footer + three icon reserves; wrapper gains `aria-busy`/`aria-label`. Proof-only toolcall rule unchanged.
2. Verify the `showHistorySkeleton` branch (`ThreadView.tsx:1840-1843`) needs no edit; verify against `ChatMessage.tsx` (sender alignment) + `ChatMessageBubble.tsx` (filled vs ghost, `metadata` prop) — no edits to either.
3. Gates.

## My merge procedure (lead reviewer = me, after both streams land)

1. Merge S1 → main; re-run its gates.
2. Merge S2 → main (trivially rebasable — disjoint files); re-run its gates.
3. Full gates: frontend `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`, `git diff --check` from repo root.
4. User-assisted browser matrix:
   - F1: authed refresh with pinned + workspace chats → Pinned icon-slot skeleton + per-workspace rows → names land in-section, no cross-section jump; zero-pin snapshot shows no Pinned section
   - F2: server-chat open/switch + deep-link pending (throttled history) → filled user bubble + assistant toolcall/footer/icon slots → real turns, no reflow; composer live throughout
   - F3: guest + demo + ready-empty: zero skeletons, zero fetches
   - F4: forced hydrate/history failure → memory + one toast each
   - Narrow viewport (<=640px), clean console, no 504s

## File touch budget

- Max five touched source files across both streams (expected: three). Exceeding it means a stream was mis-scoped — split and report.

## Risks

- Total-count temptation (reusing global `skeletonRows` for Pinned): forbidden — Pinned/Archived use their own snapshot counts; any other count source stops and reports.
- Subject-snapshot filter omission (counting pins as workspace rows again): bounded by FR3 — counts use the existing `pinKeys`/`archivedKeys`; unfiltered writes stop and report.
- Icon-slot temptation for Subjects/Archived rows: forbidden — `withIcon` is Pinned-only (real Subjects custom/demo + Archived rows pass no icon).
- Ghost-user-bubble retention ("easier to keep"): forbidden — real user bubbles are filled; the skeleton must drop `variant="ghost"` and the avatar.
- Invented toolcall/follow-up rows to "fill space": forbidden — proof-only toolcall rule stands; follow-ups never skeletoned.
- Hydration mismatch: no `typeof window`, no random values in either skeleton component.
- A concurrent run editing `Pesdac.tsx`: the prompt carries the courtesy rule — `git status --short` first, touch only owned blocks, report collisions instead of overwriting.
