# Spec: skeleton fidelity fix — pinned loader + thread bubble ditto

Status: Proposed
Audit basis: `docs/audits/2026-09-10-skeleton-pinned-thread-audit.md` (code inspection only — no code changed for this spec).
Stack: Astro + React 19 + Astryx 0.5.2 + StyleX + `PESDacMockupTheme` (per `AGENTS.md`).
Images: Image 1 = skeleton state (broken), Image 2 = real state (truth).

## 1. Problem

Two skeleton states do not ditto the real states they stand in for:

**P1 — pinned chats have no dedicated loader.** The skeleton (Image 1) shows no `Pinned` section; bars render inside the `CN`/`DLCD` workspace collapsibles. The real state (Image 2) shows the chats in a `Pinned` section above `CN`. On hydrate the rows visibly "fall into category and move to pinned section". Causes (`Pesdac.tsx`): Pinned section gated on live `pinnedRows.length > 0` (`1641`) so it never renders while hydrating; the per-subject snapshot counts pinned customs as workspace chats (`869-870`) while the live workspace list excludes them (`1676-1682`); the Pinned skeleton reuses the global total count (`1661-1663`); workspace vs Pinned gates diverge (`showWorkspaceSkeleton` vs `showChatListSkeleton`); pinned rows have a `BookmarkIcon` the label-only skeleton lacks (`1652` vs `ChatListSkeleton.tsx`).

**T1 — thread skeleton does not match the bubbles.** Real user turns are avatar-less **filled** bubbles with timestamp/edit metadata (`ThreadView.tsx:1426-1481`); the skeleton renders a ghost bubble **with** a `You` avatar and no metadata (`ThreadSkeleton.tsx:23-33`). Real assistant turns carry a toolcall chip + metadata footer with copy/vote/regenerate icons (`1483-1570`); the skeleton renders one `96×10` bar (`35-64`). The skeleton also carries no `aria-busy`/`aria-label` (promised by `chat-skeleton-loading` FR3, present on `ChatListSkeleton`, missing here).

## 2. Users

- Signed-in users with pinned chats refreshing (see a Pinned skeleton in place, then names land with no section jump).
- Signed-in users opening a server-backed chat while history loads incl. deep-link pending (see bubble-faithful skeleton turns, then real turns land with no reflow).
- Guests / demo readers / ready-empty: must see zero change.

## 3. Goals

1. Pinned (and Archived — same mechanics) skeleton renders inside its own section while hydrating, with its own count, and the real rows land in place with no section jump.
2. Workspace skeleton counts exclude pinned/archived chats so bars never paint in a workspace for rows that will land in Pinned/Archived.
3. Pinned skeleton rows reserve the Bookmark icon slot so the icon does not shift the row in late.
4. Thread skeleton turns use the real shells: user = no avatar + filled bubble + metadata slot; assistant = ghost bubble (keep) + toolcall slot (proof-only, keep rule) + metadata footer slot with timestamp + action-icon reserves.
5. `ThreadSkeleton` exposes `aria-busy` + `aria-label="Loading chat history"`.
6. Pending vs ready-empty stays distinct (ready-with-zero renders the real empty list, never a skeleton) — same doctrine as `shouldShowIdentitySkeleton` and frozen `shouldShowChatListSkeleton` / `shouldShowThreadSkeleton`.

## 4. Non-goals

- No predicate change (`session.ts` predicates FROZEN — new snapshot keys/counts are UI-layer transient state, predicates consumed as-is).
- No nav/deep-link redesign, no hydrate-path change, no mutation Spinner change.
- No follow-up pills, artifact panel, `isStreaming`, or live-turn simulation inside the skeleton (never invent affordances).
- No toolcall-shape row without proof (existing rule stands).
- No `ComposerSkeleton`, account-row skeleton, My Profile skeleton, search, shortcut, or theme change.
- No Astryx upgrade, Tailwind, global CSS, or row/bubble restyle.

## 5. User flows

### F1: Refresh with pinned chats (P1 fixed)

1. Authed refresh → memory empty, hydrate in flight → `Pinned` section header renders with N icon-slot skeleton rows where the pinned names will land; workspace collapsibles show only their unpinned/unarchived skeleton rows.
2. Hydrate resolves → pinned names land in the Pinned section in place; workspace names land in their workspaces; no row crosses sections.

### F2: Open chat while history loads (T1 fixed)

1. Open a server-backed chat with empty overlay (or deep-link pending) → message list shows the 3-turn template in the real shells: right-aligned filled user bubble skeleton with metadata slot; left assistant ghost-bubble skeletons with toolcall slot (only with proof) + timestamp/footer/action-icon slots; composer stays live.
2. History resolves → real turns replace the template in place.

### F3: Guest / demo / ready-empty (unchanged)

Zero skeletons, zero chat fetches, byte-identical rendering. Ready-with-zero renders the real empty list.

### F4: Failed hydrate / history load (unchanged surfacing)

Memory paint + exactly one existing toast; skeleton unmounts; no error-skeleton variant.

## 6. Functional requirements

### FR1: Pinned + Archived snapshot counts (edit `Pesdac.tsx` snapshot block only)

- Add two transient localStorage snapshot keys (counts only, no titles — same privacy posture as `pesdac:lastKnownChatsBySubject`):
  - `pesdac:lastKnownPinnedCount` — count of pinned, unarchived customs known live.
  - `pesdac:lastKnownArchivedCount` — count of archived customs known live.
- Write rule: same write site/conditions as the existing subject snapshot (`chatAuth != null`, live customs or live-empty clear); pinned count = customs where pinned && !archived; archived count = customs where archived. Live-empty (`chatRowsLive && customs.length === 0`) clears all three snapshots (write `{}`, `0`, `0`); pending-empty never touches any snapshot.
- Read rule: read back only while a skeleton may show (same `showWorkspaceSkeleton` window as today); parse defensively (`try/catch`, default `0`).
- Clamp: `pinnedSkeletonRows = min(max(pinnedSnapshot, 0), 3)`; same for archived. Zero snapshot → zero rows (never fake rows to fill space).

### FR2: Pinned + Archived section gating (edit `Pesdac.tsx` section blocks only)

- Pinned: render the section when `pinnedRows.length > 0 || pinnedSkeletonRows > 0`. Inside its `VStack`: live rows as today (customs still gated `return null` while `!chatRowsLive`; demos render disabled), else when skeleton-due render `<ChatListSkeleton rows={pinnedSkeletonRows} withIcon />`. Never the global `skeletonRows`.
- Archived: identical pattern with `archivedSkeletonRows` and no `withIcon` (real archived rows carry no icon).
- Gate both skeletons on `showWorkspaceSkeleton` (the same window workspaces use) so the unresolved-auth window no longer skeletons workspaces while hiding Pinned/Archived.

### FR3: Workspace counts exclude pinned/archived (edit `Pesdac.tsx` snapshot write only)

- The per-subject snapshot counts only customs where `!isPinned && !isArchived` (using the same `pinKeys`/`archivedKeys` sets the render already builds). Read path (`skeletonRowsFor`) unchanged.
- Live workspace lists already exclude pinned/archived — no render change beyond the corrected counts.

### FR4: `ChatListSkeleton` icon-slot variant (edit `ChatListSkeleton.tsx` only)

- `ChatListSkeleton({ rows, withIcon }: { rows: number; withIcon?: boolean })` — `null` when `rows <= 0`. Container unchanged (`VStack gap={0.5}`, `aria-busy="true"`, `aria-label="Loading chats"`).
- Per row: `HStack gap={2} vAlign="center"` with the existing `minHeight var(--size-element-md)` + `paddingInlineStart var(--spacing-2)` row geometry; when `withIcon` render a leading `Skeleton width={20} height={20} radius={2} index={i}` (Bookmark `size="sm"` slot) before the existing label `Skeleton 140×14 radius={1}`; otherwise byte-identical to today. Keep `index={i}` stagger. Presentational only.

### FR5: Thread skeleton ditto (rewrite `ThreadSkeleton.tsx` only)

- Wrapper carries `aria-busy="true"`, `aria-label="Loading chat history"` (fixes the missing a11y props).
- Turn 1 (user): `ChatMessage sender="user"` with **no** `avatar`; single `ChatMessageBubble` default **filled** (no `variant="ghost"`), no `group`; inside a `VStack gap={2}` with `Skeleton 140×12` + `Skeleton 96×12` (short-pill proportions, right-aligned by the sender context — no manual alignment hacks); bubble `metadata` prop carries a `ChatMessageMetadata` with a timestamp-slot `Skeleton 64×10` + edit-icon reserve `Skeleton 28×28 radius={2}` (mirrors `renderUserBlock` timestamp + pencil footer).
- Turns 2–3 (assistant): `ChatMessage sender="assistant"` + `Avatar name="PESDac" size="md"` (keep); `ChatMessageBubble variant="ghost"` (keep) with `VStack gap={2}` bars (`280+200` / `220` — keep widths); toolcall-shape row (`160×32 r2`) ONLY when the loading chat provably had toolcalls (keep today's proof-only rule — never invented); `ChatMessageMetadata` with timestamp-slot `Skeleton 64×10` + footer-slot `Skeleton 120×10` + three action-icon reserves `Skeleton 28×28 radius={2}` each (copy / vote / regenerate slots per `renderAssistantBlock`); no follow-ups, no artifact panel, no `isStreaming`.
- `ThreadView.tsx`: no logic change — the existing `showHistorySkeleton` branch (`1840-1843`) picks up the rewritten component verbatim. If the wrapper element type changes, keep the same branch condition untouched.

### FR6: No other behavior change

Predicates, `hydrateChats`/`loadChatMessages` wiring, `ConversationItem` Spinner paths, toasts, shortcuts, search filtering, composer gating, and thread send/stream/edit/regenerate/vote logic are untouched.

## 7. Acceptance criteria

- [ ] AC1: Authed refresh with pinned chats shows the Pinned section skeleton (icon-slot rows) + correct per-workspace rows → names land in their own sections, no cross-section jump; snapshot with zero pins shows no Pinned section at all.
- [ ] AC2: Thread loading shows filled right-aligned user bubble skeleton + ghost assistant skeletons with toolcall (proof-only) + timestamp/footer/action-icon slots → real turns, no reflow; deep-link pending uses the same template.
- [ ] AC3: Guest + demo + ready-empty show zero skeletons and fire zero chat fetches.
- [ ] AC4: Forced hydrate/history failure keeps memory paint + exactly one existing toast.
- [ ] AC5: `npm.cmd test` + `npm.cmd run astro -- check` + `npm.cmd run build` + `git diff --check` pass; existing skeleton predicate/clamp tests pass unmodified.
- [ ] AC6: Astryx UI/theme/copy/layout unchanged; desktop + <=640px; clean console.

## 8. Constraints

- `AGENTS.md` UI rules apply in full. Max five touched source files (expected: `Pesdac.tsx`, `ChatListSkeleton.tsx`, `ThreadSkeleton.tsx`).
- Work from main; branch per plan; no commit/push unless asked.
- Synthetic fixtures only; no PII in tests or snapshots (counts only, no titles).

## 9. API / interface requirements

- `ChatListSkeleton({ rows: number; withIcon?: boolean })` — presentational only, no fetching.
- `ThreadSkeleton()` — presentational only, no fetching; `aria-busy` + `aria-label="Loading chat history"`.
- `session.ts` predicates and `chat-sync.ts`/backend contracts are FROZEN (consume, never edit).

## 10. Data requirements

- None. No schema/migration. Two new transient localStorage count keys (same lifecycle as the existing subject snapshot).

## 11. Security requirements

- No tokens/PII in skeletons, snapshots, logs, or tests. Identity-scoped pending bits unchanged.

## 12. Testing requirements

- No new test file required (no component harness in this repo; predicate + clamp coverage in `chat-skeleton-predicates.test.ts` + `chat-list-skeleton.test.ts` passes unmodified, never rewrite assertions).
- Browser (user-assisted): F1/F2/F3/F4 on desktop + narrow; network-throttled hydrate + history load to observe both skeletons; clean console.

## 13. Rollout / rollback

- Rollout: frontend-only, branch per plan. No flag/env/migration.
- Rollback: revert branch; behavior returns to today's workspace-falling pins + ghost user skeleton. No data impact.
