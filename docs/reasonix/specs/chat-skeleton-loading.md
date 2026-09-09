# Spec: chat skeleton loading states (sidebar list + open thread, ditto + dynamic)

Status: Proposed
Audit basis: code inspection only (no code changed for this spec) — `frontend/src/components/profile/SkeletonBlock.tsx`, `frontend/src/lib/session.ts`, `frontend/src/components/Pesdac.tsx`, `frontend/src/components/chat/ThreadView.tsx`, `frontend/src/lib/chat-sync.ts`, `frontend/src/lib/chat.ts`, `frontend/src/pages/subject/[subject]/[code].astro`, `frontend/src/pages/new.astro`.
Stack: Astro + React 19 + Astryx 0.5.2 + StyleX + `PESDacMockupTheme` (per `AGENTS.md`; `CLAUDE.md` Next.js/Supabase references are stale for this repo and do not apply).

## 1. Problem

Two refresh cases render fetches without a faithful placeholder:

**S1 — sidebar list jump on refresh.** `customs = listCustomChats()` renders directly (`Pesdac.tsx:781`); `hydrateChats()` → `apiListChats()` (`session.ts:1077-1111`, `chat-sync.ts:43-46`, triggered at `Pesdac.tsx:596-601`) replaces the list with no loading UI. After a browser refresh memory is empty, so 1 chat jumps empty → populated. There is no hydrate-pending flag today (only `chatHydratedKey` at `session.ts:662`). The `pending` map at `Pesdac.tsx:762` covers pin/archive/delete row `Spinner`s only (`ConversationItem:462-492`) — unrelated and unchanged.

**S2 — open-thread skeleton is not a ditto.** `SkeletonThread()` exists (`ThreadView.tsx:449-468`) with `showHistorySkeleton` (`799-802`) rendering at `1833-1834`, but it is a fixed 2× assistant bubbles (280/200) — no user turns, no metadata/toolcall shape. Real shells are `renderUserBlock` (`1429`) and `renderAssistantBlock` (`1486`) using `ChatMessage` + `Avatar size="md"` + `ChatMessageBubble variant="ghost"` + `ChatMessageMetadata` + `ChatToolCalls`.

## 2. Users

- Signed-in users refreshing with existing chats (S1: "1 chat, click refresh → chat name skeleton").
- Signed-in users opening/switching a chat while `apiListMessages` is in flight (S2: "within a chat, refresh/fetch → appropriate skeleton").
- Guests and demo-thread readers: must see zero change (no fetches, no skeletons).

## 3. Goals

1. Sidebar shows Astryx `Skeleton` rows mirroring `ConversationItem`/`SideNavItem` rows while the chat-list hydrate is pending and no customs are painted.
2. Open thread shows skeleton turns mirroring the real message shells while `loadChatMessages` is pending and the overlay is empty (memory paint still wins otherwise).
3. Skeleton row/turn counts are dynamic (derived from known counts, capped) — never a hardcoded structure claim about unknown data.
4. Pending vs ready-empty stay visually distinct (ready-with-zero-chats renders the real empty list, never a skeleton) — same doctrine as `shouldShowIdentitySkeleton` (`session.ts:553-563`).
5. Failure keeps the memory paint + the existing single toast (`session.ts:1092-1097`, `953-958`); the skeleton just unmounts.

## 4. Non-goals

- No custom-chat deep-link / navigation redesign. Customs open in place via `draftCode` (`Pesdac.tsx:728-729`); after refresh `draftCode` is null so the user lands on welcome — the sidebar skeleton covers that case. Restoring the open thread across refresh is its own nav feature, out of scope.
- No change to mutation `Spinner`s (pin/archive/delete), the account-row skeleton (`Pesdac.tsx:1342-1356`), or My Profile skeletons (`SkeletonBlock.tsx:62-103`, `sections.tsx:340-349`).
- No skeletons for demo routes (`/subject/[subject]/[code]` — static registry `lib/chat.ts`, zero fetches) or the welcome heading/composer.
- No Astryx upgrade, Tailwind, global CSS, theme edit, or row/turn restyle.

## 5. User flows

### F1: Refresh with 1 chat (S1 fixed)

1. Authed refresh → memory empty, `hydrateChats` in flight → Subjects section shows 1 skeleton row (`HStack`: 20×20 icon + 140×14 label + 16×16 menu dot), `aria-busy`, `aria-label="Loading chats"`.
2. Hydrate resolves → skeleton unmounts, the real chat name lands in place with no layout shift.

### F2: Open/switch chat while history loads (S2 fixed)

1. Open a server-backed chat with empty overlay → `showHistorySkeleton` true → 3-turn template (user / assistant / assistant) inside the real `ChatMessage`/`Bubble`/`Metadata` shells; composer stays live.
2. `loadChatMessages` resolves → real turns replace the template in place.

### F3: Guest / demo (unchanged)

Guest refresh and any demo-thread open: zero skeletons, zero fetches, byte-identical rendering.

### F4: Failed hydrate / history load (unchanged surfacing)

Failed legs keep the memory paint + exactly one existing toast; skeleton unmounts; no error-skeleton variant.

## 6. Functional requirements

### FR1: State (append-only in `session.ts`)

- New `chatHydratePending` flag with `getChatHydratePending()` / `setChatHydratePending(b)` (`emit()` on set, mirroring `setProfileSeedPending:524`). Set true at `hydrateChats` entry (after guest/already early-returns), false on every exit (ready + kept-memory + catch), identity-guarded so a stale resolve cannot clear a newer identity's pending bit. Extend `__resetChatBackingForTesting`.
- `shouldShowChatListSkeleton(authStatus, hydratePending, customCount): boolean` → true iff `authenticated && hydratePending && customCount === 0`.
- `shouldShowThreadSkeleton(isBacked, msgStatus, overlayLen, explicitFlag?): boolean` → true iff `explicitFlag === true || (isBacked && msgStatus === "loading" && overlayLen === 0)`.
- Predicates are pure and unit-testable (same doctrine as `shouldShowIdentitySkeleton`).

### FR2: Sidebar skeleton

- New `frontend/src/components/chat/ChatListSkeleton.tsx`: `ChatListSkeleton({ rows })` renders `rows` placeholder rows in the Subjects `VStack gap 0.5` container. Row shape per §3 goal 1. `aria-busy="true"`, `aria-label="Loading chats"`.
- `rows = customs.length > 0 ? 0 (real list, no skeleton) : pending ? clamp(lastKnown ?? 1, 1, 3) : 0`. `lastKnown` is a render ref of the pre-hydrate custom count; post-refresh unknown defaults to 1 (the "1 chat" case). Cap 3. Pinned/Archived render nothing while the skeleton shows. Search box stays live.

### FR3: Thread skeleton (ditto + dynamic)

- New `frontend/src/components/chat/ThreadSkeleton.tsx`: `ThreadSkeleton()` renders the F2 3-turn template per §3 goal 2 (user 180+120 lines; assistants 280+200 and 220 + metadata 96×10 line; optional toolcall-shape `160×32 r2` row ONLY when the loading chat provably had toolcalls — never invented). `aria-busy`, `aria-label="Loading chat history"`. No `isStreaming`, no follow-ups, no artifact panel.
- `ThreadView.tsx`: `SkeletonThread` becomes a thin wrapper over `ThreadSkeleton` (minimal diff); `showHistorySkeleton` keeps `overlay.length === 0` memory-wins rule and composer-live behavior, OR-ed with the `isHistoryLoading` explicit flag as today.

### FR4: No other behavior change

Auth/profile/seed flows, `ConversationItem` Spinner paths, toasts, shortcuts, and search filtering are untouched.

## 7. Acceptance criteria

- [ ] AC1: Authed refresh with 1 chat shows 1 sidebar skeleton row → real name, no shift; ready-empty shows the real empty list (no skeleton).
- [ ] AC2: Server-chat open/switch with empty overlay shows the 3-turn ditto template → real turns; composer usable throughout; non-empty overlay never skeletons.
- [ ] AC3: Guest refresh + demo opens show zero skeletons and fire zero chat fetches.
- [ ] AC4: Forced hydrate/history failures keep memory paint + exactly one existing toast each.
- [ ] AC5: `npm.cmd test` + `astro check` + `astro build` + `git diff --check` pass; new predicate tests (node:test, no DOM lib).
- [ ] AC6: Astryx UI/theme/copy/layout unchanged; desktop + <=640px; clean console.

## 8. Constraints

- `AGENTS.md` UI rules apply in full. Max five touched source files per stream (see plan).
- Work from main; branch per stream (see plan); no commit/push unless asked.
- Synthetic fixtures only; no PII in tests.

## 9. API / interface requirements

- `getChatHydratePending(): boolean`, `setChatHydratePending(b: void): void`, `shouldShowChatListSkeleton(authStatus: string, hydratePending: boolean, customCount: number): boolean`, `shouldShowThreadSkeleton(isBacked: boolean, msgStatus: "idle"|"loading"|"ready"|"failed", overlayLen: number, explicitFlag?: boolean): boolean`.
- `ChatListSkeleton({ rows: number })`, `ThreadSkeleton()` — presentational only, no fetching.
- `chat-sync.ts` and backend contracts are FROZEN (streams consume, never edit).

## 10. Data requirements

- None. No schema/migration. Counts stay in render refs / module flags (transient).

## 11. Security requirements

- Identity-scoped pending bits (stale user-A resolve never satisfies user-B — `TaggedCache` philosophy). No tokens/PII in skeletons, logs, or tests.

## 12. Testing requirements

- Unit (node:test): hydrate-pending set/clear on every `hydrateChats` exit incl. failure; predicate truth tables (pending+0→true, ready-empty→false, guest→false, overlay>0→false, explicit-flag override); row-count clamp (0→1, 9→3).
- Existing `auth-session-flow.test.ts` + `chat-backing.test.ts` pass unmodified (extend by new files, never rewrite assertions).
- Browser (user-assisted): F1/F2/F3/F4 on desktop + narrow; Network-throttled hydrate/history to observe skeletons; clean console.

## 13. Rollout / rollback

- Rollout: frontend-only. Land state first, rebase UI streams (see plan). No flag/env/migration.
- Rollback: revert stream branches; behavior returns to today's jump + fixed 2-bubble skeleton. No data impact.
