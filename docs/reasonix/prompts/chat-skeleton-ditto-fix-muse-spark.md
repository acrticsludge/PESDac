# Muse Spark implementation prompt: chat skeleton ditto fix — sidebar placement + composer shape (single stream)

You are Muse Spark implementing in the PESDac repository. Work on medium reasoning. Read these first, in order:

- `AGENTS.md` (Astryx/UI rules in full — this stream touches components)
- `docs/reasonix/specs/chat-skeleton-ditto-fix.md` (§6 FR1–FR3 is your build order)
- `docs/reasonix/plans/chat-skeleton-ditto-fix-plan.md` (your owned files + why you never edit `session.ts`)

Key source files (open before editing):

- `frontend/src/components/Pesdac.tsx:450-504` (`ConversationItem` — `SideNavItem` + hover-only `MoreMenu`, your sidebar ditto source; Spinner stays for mutations, do NOT convert), `:810-832` (`isUserReady`/`chatRowsLive`/`showChatListSkeleton`/`skeletonRows` clamp — read-only, reuse, never re-derive), `:1552-1638` (Subjects + WORKSPACES collapsible `VStack` — your ONLY sidebar edit region), `:1703-1742` (welcome `Layout contentWidth={720}` + composer gate — your ONLY composer edit region), `:1740-1891` (real `ChatComposer`: headerActions Attach+Reference `size="sm"`, input placeholder, footerActions Auto+Settings `size="md"`, send `32px`), `:1897-1942` (subject `ToggleButtonGroup` disabled — read-only reference, do NOT skeleton)
- `frontend/src/components/chat/ChatListSkeleton.tsx` (full rewrite of the row — currently `20×20 + 140×14 + 16×16`, leading icon is wrong for Subjects rows)
- `frontend/src/components/chat/ComposerSkeleton.tsx` (full rewrite + props fix — currently bare bars/circles with no card and no props, but called with `aria-busy`/`aria-label` at `Pesdac.tsx:1738`)
- `frontend/node_modules/@astryxdesign/core/src/Chat/ChatComposer.tsx:123-220` (body/header/footer geometry you mirror — radius, padding, gaps; do NOT restyle it)
- `frontend/node_modules/@astryxdesign/core/src/Skeleton/Skeleton.tsx:124-168` (radius scale `0-4` + `"rounded"`, `index` stagger)
- `frontend/src/components/profile/SkeletonBlock.tsx:62-103` (ditto doctrine reference only)

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

Image 1 (real window) is truth; Image 2 (current skeletons) is broken. Land in-place skeletons with zero shift: indented sidebar rows where `Explain the OSI model…` (CN) and `Explain SR, JK…` (DLCD) will land, and a rounded composer card with header/input/footer in the real slots. Guests and ready-empty never skeleton.

## Hard constraints

- Touch ONLY: `frontend/src/components/chat/ChatListSkeleton.tsx`, `frontend/src/components/chat/ComposerSkeleton.tsx`, `frontend/src/components/Pesdac.tsx` (Subjects `VStack` blocks + welcome composer swap + imports only).
- NEVER edit `session.ts` (reuse `showChatListSkeleton` + `skeletonRows`; if anything about the predicate looks wrong, report file:line instead of renegotiating), `ThreadView.tsx`, `chat-sync.ts`, `lib/chat.ts`, `backend/`, theme, or CSS. NEVER touch send/stream/edit/regenerate/vote logic, search filtering, shortcuts, or any test file (existing suites must pass unmodified).
- `ChatListSkeleton({ rows }: { rows: number })` — `null` when `rows <= 0`; `VStack gap={0.5}`, `aria-busy="true"`, `aria-label="Loading chats"`; per row `HStack gap={2} vAlign="center"`: `Skeleton 140×14 radius={1}` + spacer (`marginLeft:auto`) + `Skeleton 16×16 radius="rounded"` (menu-width reserve, never interactive); `index={i}` stagger; NO leading `20×20` icon (real Subjects custom/demo rows pass no icon — only Pinned uses `BookmarkIcon`). Imports: `Skeleton` from `@astryxdesign/core/Skeleton`, `VStack`/`HStack` from `@astryxdesign/core/Layout`. No other markup.
- `ComposerSkeleton({ "aria-busy", "aria-label" })` — must accept and forward the props `Pesdac.tsx:1738` already passes (fixes the current type error). Outer `VStack gap={2} width 100%` with those aria props; inner card mirrors `ChatComposer` body (`VStack gap={2}`, body padding, container radius): header `HStack gap={1}` → `Skeleton 28×28 radius={2}` + `Skeleton 28×28 radius={2}`; input → `Skeleton 220×16 radius={1}` left-aligned; footer `HStack gap={1}` → `Skeleton 80×32 radius={2}` + `Skeleton 90×32 radius={2}` + `flex:1` spacer + `Skeleton 32×32 radius="rounded"` + `Skeleton 32×32 radius="rounded"`; stagger `index` 0–5. Presentational only.
- `Pesdac.tsx`: DELETE the section-level sibling `<ChatListSkeleton rows={2} />` block; inside each workspace `VStack` use `chatRowsLive ? real map : showChatListSkeleton ? <ChatListSkeleton rows={skeletonRows} /> : null` (never `workspaceCustoms.length` — cold `0` renders `null`); Pinned/Archived same pattern with `skeletonRows`. Keep `!isUserReady ? <ComposerSkeleton/> : <ChatComposer/>` paint-only swap (`welcomeText`/attachments survive in state). Search stays live; toggles/cards stay disabled, never skeletoned.
- Work on branch `feat/chat-skeleton-ditto-fix` (create once with `git checkout -b`). Never touch main. Do not commit, push, or reset files. Max five touched files.

## Required working method

Work in order: (1) list row, (2) composer card + props, (3) Pesdac wiring, (4) gates. Report after each with:

```text
Task: D_
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

- Pending-vs-empty stays distinct: ready-with-zero-chats renders the real empty list. Failure keeps memory paint + existing toast; skeleton just unmounts.
- No layout shift: skeleton lives in the same collapsible `VStack` / same 720 composer width as the real rows/card. No overlay, no modal, no Spinner swap, no full-area composer block.
- No `typeof window`, no random values in skeleton components (hydration safety).

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`. From repo root: `git diff --check`, `git status --short`. Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Authed refresh with customs: indented skeleton rows inside the correct workspace collapsibles → real names, no shift; no section-level block (browser, throttled hydrate if feasible).
- `!isUserReady` welcome: rounded composer-card skeleton in Image 1 slots → real composer, drafts survive (browser, slow user data if feasible).
- Guest + ready-empty + demo: zero skeletons, zero fetches.
- Full gates green; `Pesdac.tsx` diff confined to the owned blocks + imports.
- Final report: files changed + why, test/browser results.
