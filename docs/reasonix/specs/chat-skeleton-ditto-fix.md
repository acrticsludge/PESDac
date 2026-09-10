# Spec: chat skeleton ditto fix — sidebar placement + welcome composer shape

Status: Proposed
Audit basis: code inspection only (no code changed for this spec) — `frontend/src/components/chat/ChatListSkeleton.tsx`, `frontend/src/components/chat/ComposerSkeleton.tsx`, `frontend/src/components/Pesdac.tsx:450-504,810-832,1552-1638,1703-1891`, `frontend/node_modules/@astryxdesign/core/src/Chat/ChatComposer.tsx:123-220`, `frontend/node_modules/@astryxdesign/core/src/Skeleton/Skeleton.tsx`.
Stack: Astro + React 19 + Astryx 0.5.2 + StyleX + `PESDacMockupTheme` (per `AGENTS.md`; `CLAUDE.md` Next.js/Supabase references are stale for this repo and do not apply).

## 1. Problem

State layer from `chat-skeleton-loading` already landed (`getChatHydratePending`, `shouldShowChatListSkeleton`, `skeletonRows = clamp(lastKnown ?? 1, 1, 3)` at `Pesdac.tsx:818-832`). The shapes/placement built on top do not ditto Image 1 (real window), producing Image 2 (broken skeletons):

**D1 — sidebar skeleton floats at section level.** `Pesdac.tsx:1558-1560` renders `<ChatListSkeleton rows={2} />` as a sibling to `WORKSPACES` inside the Subjects section. Real custom chats render indented *inside* each workspace collapsible `VStack` (`1610-1633`) as `ConversationItem` → `SideNavItem`. Image 2 shows 2 generic rows at the top; Image 1 shows `Explain the OSI model…` indented under `CN` and `Explain SR, JK…` indented under `DLCD`. The inner branch (`1631-1633`) uses `workspaceCustoms.length`, which is `0` on cold refresh (memory wiped) → `ChatListSkeleton` returns `null` (`rows <= 0`). Same for Pinned (`1541-1547`) and Archived (`1659-1666`): filtered custom length is `0` on cold load → `null`. Net: cold load never skeletons where the names will land.

**D2 — sidebar row shape over-claims.** `ChatListSkeleton.tsx:17-23` renders `HStack`: `Skeleton 20×20` (icon) + `140×14` (label) + `16×16` (menu dot, always visible). Real Subjects custom/demo rows (`ConversationItem:450-504`, used at `1599-1628`) pass *no* `icon` prop — `SideNavItem` label only, `MoreMenu` only on hover (`showMenu = isHovered || isMenuOpen`). Only Pinned rows pass an icon (`BookmarkIcon` at `1532`). The always-visible menu dot + leading icon misaligns the Subjects rows and causes shift on swap. `HStack padding={1}` does not match `SideNavItem` row height/padding.

**D3 — composer skeleton is not the composer.** `ComposerSkeleton.tsx:15-40` is a bare `VStack`: `200×16 + 120×16 + 40×40` on one row, `40 + 40 + 120×40 + 40×40` on the next. Real welcome composer (`Pesdac.tsx:1740-1890`) is `ChatComposer` body (`ChatComposer.tsx:146-220`): outer radius `--radius-chat` (28px), padding `spacing-3`, bg `--color-background-popover`, shadow low; `header minHeight 28px` (Attach + Reference `@` icon-only `size="sm"`); `inputArea` placeholder (`Ask anything about your course…`); `footer minHeight 32px` (Auto `size="md"` + Settings `size="md"` left, dictation + send `32px` right). Image 2 shows bare bars/circles with no card; Image 1 shows the rounded card with paperclip/`@` top, placeholder middle, Auto/Settings + mic/send bottom. Width is constrained by `Layout contentWidth={720}` (`1705`) — skeleton must hold the same width. TS defect: `Pesdac.tsx:1738` passes `aria-busy`/`aria-label` but `ComposerSkeleton()` takes no props.

## 2. Users

- Signed-in users refreshing with existing customs (see their names skeleton indented in place, then land with no shift).
- Signed-in users cold-loading the `/new` welcome view (see the composer card skeleton in place while `!isUserReady`).
- Guests / demo readers / ready-empty: must see zero change.

## 3. Goals

1. Sidebar skeletons render *inside* each workspace collapsible `VStack` where `workspaceCustoms` map, indented exactly as the real rows, using the existing `skeletonRows` count (clamp 1–3, default 1). No top-level floating block.
2. Sidebar skeleton row holds the real row's width/height so swap is shift-free: label-width placeholder + trailing menu-width reserve (accounts for hover-only `MoreMenu`), no leading icon for Subjects rows.
3. Welcome composer skeleton mirrors the `ChatComposer` body geometry (rounded card, header/input/footer slots in Image 1 positions/sizes) at the same 720 width, `aria-busy` + `aria-label="Loading composer"`.
4. Pending vs ready-empty stays distinct (ready-with-zero renders the real empty list, never a skeleton) — same doctrine as `shouldShowIdentitySkeleton` and the frozen `shouldShowChatListSkeleton`.
5. Failure keeps memory paint + existing single toast; skeleton just unmounts.

## 4. Non-goals

- No state/predicate change (`session.ts`, `chat-sync.ts` FROZEN — consume only).
- No `ThreadSkeleton` / thread-history change (covered by stream C, untouched).
- No nav/deep-link redesign (customs still open in place via `draftCode`; refresh still lands on welcome — sidebar skeleton is the coverage).
- No change to mutation `Spinner`s, account-row skeleton (`Pesdac.tsx:1395-1409`), My Profile skeletons, search filtering, shortcuts, or subject `ToggleButtonGroup` behavior (toggles stay `isDisabled={!isUserReady}`, never skeletoned).
- No Astryx upgrade, Tailwind, global CSS, theme edit, or row/composer restyle.

## 5. User flows

### F1: Refresh with customs under CN + DLCD (D1+D2 fixed)

1. Authed refresh → memory empty, `showChatListSkeleton` true → each workspace that will receive customs shows `skeletonRows` indented placeholder rows inside its collapsible (`CN` shows 1 label-width bar where `Explain the OSI model…` will land; `DLCD` same for `Explain SR, JK…`).
2. Hydrate resolves → real names land in place, no shift, no top-level block ever appears.

### F2: Cold welcome while `!isUserReady` (D3 fixed)

1. `/new` with user data pending → rounded composer-card skeleton (paperclip/`@` slots top-left, placeholder bar middle, Auto/Settings bottom-left, mic/send circles bottom-right) at composer width; subject toggles + suggestion cards render disabled below as today.
2. `isUserReady` flips → real `ChatComposer` lands in the same card geometry; `welcomeText` + staged attachments survive (paint-only swap).

### F3: Guest / demo / ready-empty (unchanged)

Zero skeletons, zero chat fetches, byte-identical rendering. Ready-with-zero-chats renders the real empty list.

### F4: Failed hydrate (unchanged surfacing)

Memory paint + exactly one existing toast; skeleton unmounts; no error-skeleton variant.

## 6. Functional requirements

### FR1: Sidebar placement (edit `Pesdac.tsx` owned block only)

- Delete the section-level sibling block (`1558-1560`, `rows={2}`).
- Inside each workspace `VStack` (current `1631-1633`): `chatRowsLive ? real workspaceCustoms.map(...) : showChatListSkeleton ? <ChatListSkeleton rows={skeletonRows} /> : null`. Never `workspaceCustoms.length` (cold `0` → `null` bug). `skeletonRows` is the existing clamp (`830-832`).
- Pinned (`1541-1547`) / Archived (`1659-1666`): same rule — gated customs return `null`, skeleton branch uses `skeletonRows` (not filtered length), demos render disabled as today. When the section has zero customs of that kind, render nothing (do NOT fake rows to fill space).
- Search input stays live; collapsible headers (`CN`/`OS`/`DLCD`/`DSA`/`Math`) stay live.

### FR2: Sidebar row shape (rewrite `ChatListSkeleton.tsx` only)

- `ChatListSkeleton({ rows }: { rows: number })`, `null` when `rows <= 0`. `VStack gap={0.5}`, `aria-busy="true"`, `aria-label="Loading chats"`.
- Per row: `HStack gap={2} vAlign="center"` holding `Skeleton width={140} height={14} radius={1}` (label slot — matches real custom-row label width) + `marginLeft:auto` reserve `Skeleton width={16} height={16} radius="rounded"` (menu-width reserve so hover `MoreMenu` does not reflow; visually muted, never interactive). No leading `20×20` icon for Subjects rows (real custom/demo rows have none). Keep `index={i}` stagger. No other markup. Imports: `Skeleton` from `@astryxdesign/core/Skeleton`, `VStack`/`HStack` from `@astryxdesign/core/Layout`.

### FR3: Composer shape (rewrite `ComposerSkeleton.tsx` only)

- `ComposerSkeleton(props: { "aria-busy"?: boolean | string; "aria-label"?: string })` — fixes the `Pesdac.tsx:1738` prop error. Outer `VStack gap={2} width 100%` carrying the aria props.
- Inner card mirrors `ChatComposer` body: padding `spacing-3` equivalent, radius container, same `VStack gap={2}` rhythm. Slots, in order: header `HStack gap={1}` → `Skeleton 28×28 radius={2}` + `Skeleton 28×28 radius={2}` (attach + reference `size="sm"` slots, `minHeight 28`); input → `Skeleton 220×16 radius={1}` left-aligned with input-area vertical rhythm (placeholder slot); footer `HStack gap={1}` → `Skeleton 80×32 radius={2}` (Auto `size="md"`) + `Skeleton 90×32 radius={2}` (Settings `size="md"`) + `flex:1` spacer + `Skeleton 32×32 radius="rounded"` (dictation) + `Skeleton 32×32 radius="rounded"` (send, `32px` match). Stagger `index` 0–5. Presentational only.
- `Pesdac.tsx:1737-1738`: keep `!isUserReady ? <ComposerSkeleton …/> : <ChatComposer …/>` paint-only swap; `welcomeText`/attachments stay in state.

### FR4: No other behavior change

Predicates, `hydrateChats` wiring, `ConversationItem` Spinner paths, toasts, shortcuts, search filtering, `ToggleButtonGroup` disabled rule, and `ThreadView` are untouched.

## 7. Acceptance criteria

- [ ] AC1: Authed refresh with customs shows indented skeleton rows inside the correct workspace collapsibles → real names, no shift; no section-level block; ready-empty shows the real empty list.
- [ ] AC2: `!isUserReady` welcome shows the rounded composer-card skeleton (header/input/footer in Image 1 slots) at composer width → real composer, no reflow; drafts survive; toggles/cards disabled, never skeletoned.
- [ ] AC3: Guest + demo + ready-empty show zero skeletons and fire zero chat fetches.
- [ ] AC4: Forced hydrate failure keeps memory paint + exactly one existing toast.
- [ ] AC5: `npm.cmd test` + `npm.cmd run astro -- check` + `npm.cmd run build` + `git diff --check` pass; existing predicate/row-clamp tests pass unmodified.
- [ ] AC6: Astryx UI/theme/copy/layout unchanged; desktop + <=640px; clean console.

## 8. Constraints

- `AGENTS.md` UI rules apply in full. Max five touched source files (expected: three).
- Work from main; single branch (see plan); no commit/push unless asked.
- Synthetic fixtures only; no PII in tests.

## 9. API / interface requirements

- `ChatListSkeleton({ rows: number })` — presentational only, no fetching.
- `ComposerSkeleton({ "aria-busy"?: boolean | string; "aria-label"?: string })` — presentational only.
- `session.ts`, `chat-sync.ts`, backend contracts are FROZEN (consume, never edit).

## 10. Data requirements

- None. No schema/migration. Counts stay in the existing render ref / module flag (transient).

## 11. Security requirements

- No tokens/PII in skeletons, logs, or tests. Identity-scoped pending bits unchanged.

## 12. Testing requirements

- No new test file (no component harness in this repo; predicate + clamp coverage already lives in `chat-skeleton-predicates.test.ts` + `chat-list-skeleton.test.ts` — pass unmodified, never rewrite assertions).
- Browser (user-assisted): F1/F2/F3/F4 on desktop + narrow; network-throttled hydrate + slow `!isUserReady` to observe both skeletons; clean console.

## 13. Rollout / rollback

- Rollout: frontend-only, single branch. No flag/env/migration.
- Rollback: revert branch; behavior returns to today's floating rows + bare composer skeleton. No data impact.
