# Audit: skeleton states vs real states — pinned loader + thread bubbles

Date: 2026-09-10
Images: Image 1 = skeleton state, Image 2 = real (loaded) state
Scope: code inspection only — no code changed for this audit.
Files inspected:
- `frontend/src/components/Pesdac.tsx` (sidebar + welcome/thread routing)
- `frontend/src/components/chat/ChatListSkeleton.tsx`
- `frontend/src/components/chat/ThreadSkeleton.tsx`
- `frontend/src/components/chat/ThreadView.tsx` (`renderUserBlock`, `renderAssistantBlock`, `showHistorySkeleton`)
- `frontend/src/lib/session.ts` (`shouldShowChatListSkeleton`, `shouldShowThreadSkeleton`, `listPinned`, `listArchived`, snapshot keys)
- `frontend/node_modules/@astryxdesign/core/src/Chat/ChatMessage.tsx`, `ChatMessageBubble.tsx`

## 1. Sidebar flow today (how a reload paints)

1. `customs = listCustomChats()` reads render-direct (`Pesdac.tsx:802`), reactive via `useSessionVersion()`.
2. `pinnedRefs = listPinned()` (`803`), `archivedRefs = listArchived()` (`804`); `pinnedRows`/`archivedRows` derived via `collectRows` (`1246-1256`).
3. Readiness: `isUserReady` (U) + `isChatReady` (C) → `chatRowsLive = U && C` (`821-828`).
4. Skeleton predicates:
   - `showChatListSkeleton = shouldShowChatListSkeleton(authStatus, hydratePending, customs.length)` (`831-835`) = `authenticated && hydratePending && customCount === 0` (`session.ts:604-610`).
   - `skeletonRows = clamp(lastKnownCustomsRef, 1, 3)` when showing (`841-843`).
   - `showWorkspaceSkeleton = showChatListSkeleton || authUnresolved` (`904-905`), where `authUnresolved = authState.status === "loading"`.
   - Per-workspace `skeletonRowsFor(subject)` reads `pesdac:lastKnownChatsBySubject` snapshot, clamped 0–3 (`917-920`).
5. Snapshot write (`865-894`): when `chatAuth != null` and customs live, counts **every** custom per subject — `counts[c.subject]++` with no pin/archive filter — and writes to `pesdac:lastKnownChatsBySubject`.

## 2. Finding P1 — pinned chats have no dedicated loader (user-confirmed)

Real state (Image 2) has a `Pinned` section (`Explain SR, JK, D and T flip-flops`) above the `CN` workspace. Skeleton state (Image 1) has **no** `Pinned` section at all — only `CN`/`OS`/`DLCD`/`DSA`/`Math` workspace headers with bars under `CN` and `DLCD`.

Root causes, all in `Pesdac.tsx`:

- **P1a — Pinned section is gated on live rows.** `1641: {pinnedRows.length > 0 && (<SideNavSection title="Pinned">…` — during hydrate `customs` is empty so server-flagged pins vanish (`listPinned` `fromFlags` needs `customs`; `session.ts:313-328`), `pinnedRows` is empty, the whole section (including its skeleton block at `1661-1663`) never renders.
- **P1b — workspace snapshot counts pinned chats as workspace chats.** The snapshot (`869-870`) includes pinned customs, but the live workspace list explicitly excludes them (`1676-1682`: `!isPinnedHere(...)`). So the skeleton paints N bars **inside the workspace collapsible** (`1745-1749`) and the real rows later land in the **Pinned section** — exactly the "falls into category and moves to pinned section after loading" jump the user reports.
- **P1c — pinned skeleton uses the wrong count.** Even when the Pinned section does render (demo/key-set pins survive via `PINS_KEY`), its skeleton block uses the **global** `skeletonRows` total (`1661-1663`), not a pinned count. A user with 1 pinned + 2 workspace chats gets up to 3 skeleton rows in Pinned plus per-workspace rows — over-claim.
- **P1d — gate divergence.** Workspaces skeleton on `showWorkspaceSkeleton` (includes the `authUnresolved` window); Pinned/Archived skeleton only on `showChatListSkeleton` (requires `authenticated`). During the unresolved window workspaces skeleton while Pinned stays hidden — second shift source.
- **P1e — row shape mismatch for Pinned.** Real pinned rows pass `icon={BookmarkIcon}` (`1652`); `ChatListSkeleton` is label-only by design (ditto-fix FR2 — Subjects rows have no icon). A pinned skeleton → real swap therefore gains a 20px icon slot late. Archived rows have no icon (correct as-is); only Pinned needs the icon-slot variant.
- Same pattern exists for Archived (`1756-1780`: gated on `archivedRows.length`, same global count) — unreported but identical mechanics; fix together or consciously defer.

## 3. Finding T1 — thread skeleton does not ditto the bubbles (user-confirmed)

Real thread (Image 2) vs skeleton (Image 1):

| Real (`ThreadView.tsx`) | Skeleton (`ThreadSkeleton.tsx`) | Delta |
|---|---|---|
| User: `ChatMessage sender="user"` with **no avatar**, `ChatMessageBubble` default **filled** + `group` + `metadata` (timestamp + edit pencil) (`1426-1481`) | Turn 1: `sender="user"` **with** `Avatar name="You"`, bubble `variant="ghost"`, two bars `180×12 + 120×12`, **no metadata** (`23-33`) | Ghost-vs-filled visual mismatch; extra avatar injects 32px + gap the real row never has (`ChatMessage.tsx:89-92` row-reverse + `avatarWrap`); missing metadata row shifts footer in late; fixed two-line bars vs real short pills (`hello`, `Walk me through it step by step`) |
| Assistant: `sender="assistant"` + `Avatar PESDac md` + ghost bubbles + **`ChatToolCalls`** chip (`retrieve/search …ms`) + **`ChatMessageMetadata`** (timestamp + `PESDac · CN` footer + copy/vote/regenerate icon row) + follow-up pills (`1483-1570`, `1890-1907`) | Turns 2–3: ghost bubbles (correct) + single metadata bar `96×10 rounded`, **no toolcall shape, no icon row** (`35-64`) | Toolcall line + action-icon row pop in late; paragraph widths (full-width markdown) vs fixed `280/200/220` bars; follow-up pills intentionally absent (do not invent) but their absence is a visible gap vs Image 2 — document, don't fake |
| Shell: `ChatMessageList isStreaming`, density `spacious` (`1666-1667`, `1840`) | Rendered inside same list (good) | Keep |
| a11y: list has streaming semantics | `ThreadSkeleton` returns a bare fragment — **no `aria-busy`, no `aria-label`** (spec `chat-skeleton-loading` FR3 promised both; `ChatListSkeleton` has them, `ThreadSkeleton` lost them) | a11y gap |

Also affected: the deep-link pending path (`Pesdac.tsx:1800-1825` `provisionalThread` + `isHistoryLoading`) renders the same `ThreadSkeleton` via `showHistorySkeleton` (`ThreadView.tsx:790-793`) — inherits the full mismatch.

## 4. What is NOT broken (preserve)

- Predicate doctrine (`session.ts:599-625`): pending-vs-ready-empty distinction, `overlay.length === 0` memory-wins rule, `explicitFlag` override — correct, frozen.
- `ComposerSkeleton`, account-row skeleton, `ConversationItem` mutation Spinners, search box liveness, `ToggleButtonGroup` disabled rule — out of scope.
- No backend/schema impact; counts stay in render refs / localStorage snapshots (transient).

## 5. Fix direction (spec will lock)

- **Pinned:** separate pinned (+ archived) snapshot counts; gate the Pinned section on `pinnedRows.length > 0 || pinnedSkeletonDue`; skeleton inside the Pinned `VStack` with a `withIcon` (Bookmark-slot) row variant; exclude pinned/archived from per-subject workspace counts.
- **Thread:** rewrite `ThreadSkeleton` turns to the real shells — user turn: no avatar, filled bubble, metadata-slot skeleton; assistant turns: ghost bubble (keep), toolcall-chip skeleton only with proof (keep rule), metadata footer skeleton with timestamp bar + icon reserves; wrap with `aria-busy`/`aria-label="Loading chat history"`; keep 3-turn template, no follow-ups, no artifact panel, no `isStreaming`.
