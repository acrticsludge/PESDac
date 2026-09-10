# Muse Spark implementation prompt: skeleton fidelity fix — pinned loader + thread ditto (two streams)

You are Muse Spark implementing in the PESDac repository. Work on medium reasoning. Read these first, in order:

- `AGENTS.md` (Astryx/UI rules in full — both streams touch components)
- `docs/audits/2026-09-10-skeleton-pinned-thread-audit.md` (P1a–P1e + T1 evidence with file:line — your why)
- `docs/reasonix/specs/skeleton-pinned-thread-fix.md` (§6 FR1–FR6 is your build order)
- `docs/reasonix/plans/skeleton-pinned-thread-fix-plan.md` (your owned files + branch per stream)

Key source files (open before editing):

- `frontend/src/components/Pesdac.tsx:830-920` (`showChatListSkeleton`/`skeletonRows`/`showWorkspaceSkeleton`/subject snapshot — S1's edit region), `:1246-1256` (`collectRows`), `:1641-1666` (Pinned section — S1), `:1668-1754` (workspaces + `workspaceCustoms` filter — S1), `:1756-1780` (Archived — S1), `:1788-1830` (deep-link pending — read-only)
- `frontend/src/components/chat/ChatListSkeleton.tsx` (S1: add `withIcon` only — Subjects path byte-identical)
- `frontend/src/components/chat/ThreadSkeleton.tsx` (S2: full rewrite — currently ghost user bubble with `You` avatar, single-bar metadata, no aria props)
- `frontend/src/components/chat/ThreadView.tsx:1426-1481` (`renderUserBlock` — S2's user ditto source: no avatar, filled bubble, timestamp+edit metadata), `:1483-1570` (`renderAssistantBlock` — S2's assistant ditto source: ghost bubble + `ChatToolCalls` + metadata footer with copy/vote/regenerate), `:790-793` + `:1840-1843` (`showHistorySkeleton` branch — read-only, no logic change)
- `frontend/node_modules/@astryxdesign/core/src/Chat/ChatMessage.tsx:89-92` (sender alignment — why the user avatar must go), `ChatMessageBubble.tsx:46-63,81-98` (filled vs ghost, `metadata` prop)
- `frontend/src/lib/session.ts:599-625` (predicates — FROZEN, reuse only)

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

Image 2 (real) is truth; Image 1 (skeleton) is broken. (S1) Pinned chats skeleton in their own section with icon slots instead of falling into workspaces and jumping sections on load. (S2) Thread skeleton turns use the real bubble shells instead of ghost-with-avatar user rows and single-bar metadata. Guests and ready-empty never skeleton.

## Hard constraints

- S1 touches ONLY: `frontend/src/components/Pesdac.tsx` (snapshot keys + Pinned/Archived gates + counts + imports) and `frontend/src/components/chat/ChatListSkeleton.tsx` (`withIcon` variant). S2 touches ONLY: `frontend/src/components/chat/ThreadSkeleton.tsx`. NEVER edit `session.ts`, `ThreadView.tsx`, `chat-sync.ts`, `lib/chat.ts`, `backend/`, theme, or CSS. NEVER touch send/stream/edit/regenerate/vote logic, search filtering, shortcuts, or any test file (existing suites must pass unmodified).
- S1 — snapshots: add `pesdac:lastKnownPinnedCount` (pinned && !archived customs) + `pesdac:lastKnownArchivedCount` (archived customs), same write/read lifecycle as the subject snapshot; live-empty clears all three, pending-empty touches none; defensive parse, clamp 0–3, zero → zero rows. Filter the per-subject snapshot to `!isPinned && !isArchived` via the existing `pinKeys`/`archivedKeys`. Pinned gate → `pinnedRows.length > 0 || pinnedSkeletonRows > 0` with `<ChatListSkeleton rows={pinnedSkeletonRows} withIcon />` on the `showWorkspaceSkeleton` window; Archived same with its count and no `withIcon`. NEVER reuse global `skeletonRows` for Pinned/Archived; NEVER pass `withIcon` outside Pinned.
- S1 — row variant: `ChatListSkeleton({ rows, withIcon })`, `null` when `rows <= 0`; leading `Skeleton 20×20 radius={2}` only when `withIcon`; everything else (container aria props, row geometry, label bar, `index` stagger) unchanged. Presentational only.
- S2 — `ThreadSkeleton` rewrite: wrapper `aria-busy="true"` + `aria-label="Loading chat history"`; Turn 1 user = `ChatMessage sender="user"` NO avatar + filled `ChatMessageBubble` (no ghost, no `group`) with `140×12 + 96×12` bars and bubble-`metadata` = `ChatMessageMetadata` (timestamp `64×10` + edit reserve `28×28 r2`); Turns 2–3 assistant = `sender="assistant"` + `Avatar PESDac md` + ghost bubbles (keep widths) + proof-only toolcall `160×32 r2` row + `ChatMessageMetadata` (timestamp `64×10` + footer `120×10` + three `28×28 r2` action reserves). No follow-ups, no artifact panel, no `isStreaming`. Presentational only.
- One branch per stream (`feat/skeleton-pinned-loader`, `feat/skeleton-thread-ditto`; create once with `git checkout -b`). Never touch main. Do not commit, push, or reset files. Max five touched files total.

## Required working method

Work in order: (1) S1 list variant, (2) S1 Pesdac wiring, (3) S2 thread rewrite, (4) gates. Report after each with:

```text
Task: S_/FR_
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

- Pending-vs-empty stays distinct: ready-with-zero renders the real empty list; zero-pin snapshot renders no Pinned section. Failure keeps memory paint + existing toast; skeleton just unmounts.
- No layout shift: Pinned skeleton lives in the Pinned `VStack` with icon slots; workspace counts exclude pins; thread skeleton lives in the same `ChatMessageList` shells as the real turns. No overlay, no modal, no Spinner swap.
- No `typeof window`, no random values in skeleton components (hydration safety).

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`. From repo root: `git diff --check`, `git status --short`. Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Authed refresh with pinned chats: Pinned section skeleton (icon-slot rows) + correct workspace rows → names land in-section, no cross-section jump; zero-pin shows no Pinned section (browser, throttled hydrate if feasible).
- Thread loading (incl. deep-link pending): filled right-aligned user bubble + assistant toolcall (proof-only) + timestamp/footer/action-icon slots → real turns, no reflow; composer live (browser, throttled history if feasible).
- Guest + demo + ready-empty: zero skeletons, zero fetches.
- Full gates green; diffs confined to owned blocks.
- Final report: files changed + why, test/browser results.
