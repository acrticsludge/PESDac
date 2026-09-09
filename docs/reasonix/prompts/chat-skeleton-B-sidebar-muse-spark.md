# Muse Spark implementation prompt: Stream B — sidebar list skeleton (parallel-safe)

You are Muse Spark implementing in the PESDac repository. Work on medium reasoning. Read these first, in order:

- `AGENTS.md` (Astryx/UI rules in full — this stream touches components)
- `docs/reasonix/specs/chat-skeleton-loading.md` (§6 FR2 is your build order)
- `docs/reasonix/plans/chat-skeleton-loading-plan.md` (your stream row + why you never edit `session.ts`)

Key source files (open before editing):

- `frontend/src/components/profile/SkeletonBlock.tsx:62-103` (`SkeletonCard` ditto pattern: real shells, matched widths, dividers, `aria-busy`)
- `frontend/src/components/Pesdac.tsx:462-492` (`ConversationItem` — Spinner stays for mutations, do NOT convert), `:762-772` (row-pending map), `:781` (customs direct render), `:1444-1568` (search + Subjects/Pinned/Archived — your ONLY edit region + imports), `:1342-1356` (account-row skeleton — read-only reference, do NOT touch)
- `frontend/src/lib/session.ts:553-563` (predicate doctrine — import, never edit)

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

Render sidebar skeleton rows while the chat-list hydrate is pending and nothing is painted. Guests and ready-empty never skeleton. Keep every mutation Spinner, the search box, and all menus working exactly as today.

## Hard constraints

- Touch ONLY: `frontend/src/components/chat/ChatListSkeleton.tsx` (new), `frontend/src/components/Pesdac.tsx` (Subjects/Pinned/Archived block + imports only), `frontend/tests/chat-list-skeleton.test.ts` (new).
- NEVER edit `session.ts` (import `getChatHydratePending` + `shouldShowChatListSkeleton` — if they do not exist on your pre-A base, keep the documented heuristic `chatAuth != null && <hydrate-pending> && customs.length === 0` on one clearly-marked line and note it for the rebase; do NOT stub `session.ts`), `ThreadView.tsx`, `chat-sync.ts`, backend, theme, or CSS.
- New component: `ChatListSkeleton({ rows }: { rows: number })` — `VStack gap 0.5`; per row `HStack gap 2 vAlign center`: `Skeleton 20x20 r2` + `Skeleton 140x14 r1` + spacer + `Skeleton 16x16`; `aria-busy="true"`, `aria-label="Loading chats"`. Imports: `Skeleton` from `@astryxdesign/core/Skeleton`, `VStack`/`HStack` from `@astryxdesign/core/Layout`. No other markup.
- Rows rule: `customs.length > 0 → real list`; else pending → `clamp(lastKnownRef ?? 1, 1, 3)` (default 1 = the 1-chat refresh case; cap 3). Pinned/Archived render nothing while skeleton shows. Search input stays live.
- Work on branch `feat/chat-skeleton-sidebar` (create once with `git checkout -b`). Never touch main. Do not commit, push, or reset files. Max five touched files.

## Required working method

Work in order: (1) new component, (2) Pesdac wiring, (3) clamp/test, (4) gates. Report after each with:

```text
Task: B_
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

- Pending-vs-empty stays distinct: ready-with-zero-chats renders the real empty list (no skeleton). Failure keeps memory paint + existing toast; skeleton just unmounts.
- No layout shift: skeleton lives in the same list container/padding as the real rows. No overlay, no modal, no Spinner swap.
- Test (node:test): row-clamp helper (0→1, 9→3) via an exported pure helper; predicate import path asserted by usage, not by stubbing.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`. From repo root: `git diff --check`, `git status --short`. Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Authed refresh with 1 chat: 1 skeleton row → real name, no shift (browser, throttled hydrate if feasible).
- Guest + ready-empty + demo: zero skeletons.
- Full gates green; `Pesdac.tsx` diff confined to the owned block + imports.
- Final report: files changed + why, fallback-line location (if any) for the rebase, test/browser results.
