# Spec: thread history loader — running toolcall chip replaces skeleton turns

Status: Proposed
Audit basis: `docs/audits/2026-09-10-skeleton-pinned-thread-audit.md` §3 (T1), the skeleton-ditto fix now on main (`f5f0744`), and the `/mockups` exploration route (`frontend/src/pages/mockups.astro` + `ThreadLoaderMockups.tsx`) where Option B was reviewed live and selected.
Stack: Astro + React 19 + Astryx 0.5.2 + StyleX + `PESDacMockupTheme` (per `AGENTS.md`).

## 1. Problem

The thread history placeholder (`ThreadSkeleton.tsx`, ditto-fixed in `f5f0744`) mimics content-shaped bars, but a loading chat's true structure is unknowable in advance — blocks may be `text/markdown/quiz/code/mention/image/pdf/artifactCard/mcq/steps` with toolcall chips, follow-up pills, and system dividers (`ThreadView.tsx` `renderBubble`/`renderAssistantBlock`). Every load therefore ends with a structural correction. Worse, the modal case is a fast single `apiListMessages` round-trip (`session.ts:1054-1089`) while `Skeleton` has a 1000ms pre-animation delay (`Skeleton.tsx:30`) — so the most common load shows *static* gray bars that look broken and say nothing. Decision (reviewed on `/mockups`): replace the bar template with Option B — one honest running toolcall chip in the real assistant shell. It claims no structure, animates from frame zero, and speaks the chip language already used by real turns (`retrieve/search …ms`).

## 2. Users

- Signed-in users opening a server-backed chat while history loads, incl. deep-link pending and the `!isAppReady` gate (see a working chip, then real turns land).
- Screen-reader / reduced-motion users (get a `role="status"` announcement + slowed spinner instead of frozen gray blocks).
- Guests / demo readers / ready-empty: must see zero change.

## 3. Goals

1. History loading renders one assistant row — PESDac avatar, ghost bubble, single running `ChatToolCalls` chip — instead of the 3-turn bar template.
2. The chip uses the exact props approved on `/mockups`: `{ name: "history", target: "Chat history", status: "running" }` (single call renders inline, no collapsible — per `ChatToolCalls` design).
3. Loading is announced (chip's running `Spinner` carries `role="status"`; wrapper keeps `aria-busy` + `aria-label="Loading chat history"`).
4. Pending vs ready-empty stays distinct (ready-with-zero renders the real empty list, never the chip) — frozen `shouldShowThreadSkeleton` doctrine unchanged.
5. Component name stops lying: it is not a skeleton anymore.

## 4. Non-goals

- No predicate, fetch, or gate change (`session.ts` FROZEN — `shouldShowThreadSkeleton`, `loadChatMessages`, `isHistoryLoading` explicit flag all consumed as-is).
- No `ThreadView` logic change (same `showHistorySkeleton` branch, same composer-live behavior, no follow-ups, no artifact panel, no `isStreaming`).
- No sidebar, composer, account-row, or My Profile skeleton change.
- No toolcall-semantics debate relitigation (accepted: a fetch-status chip in `ChatToolCalls` clothing; it never persists, never fires tools).
- No Astryx upgrade, Tailwind, global CSS, theme edit, or bubble restyle.

## 5. User flows

### F1: Open chat while history loads (fixed)

1. Open a server-backed chat with empty overlay (or deep-link pending, or gated `!isAppReady`) → one assistant row with a running "history / Chat history" chip; composer stays live.
2. History resolves → real turns replace the chip in place (list only ever grows — no fake height to collapse).

### F2: Guest / demo / ready-empty (unchanged)

Zero loaders, zero chat fetches, byte-identical rendering. Ready-with-zero renders the real empty list.

### F3: Failed history load (unchanged surfacing)

Memory paint + exactly one existing toast ("Couldn't load this chat's history…"); chip unmounts; no error-chip variant.

## 6. Functional requirements

### FR1: New `ThreadHistoryLoader` component (delete `ThreadSkeleton.tsx`, add `ThreadHistoryLoader.tsx`)

- `ThreadHistoryLoader()` — presentational only, no props, no fetching:
  - Wrapper `VStack gap={4}` (matches the `ChatMessageList` balanced inner gap — same reasoning as today) with `aria-busy="true"`, `aria-label="Loading chat history"`.
  - Single `ChatMessage sender="assistant"` + `Avatar name="PESDac" size="md"`.
  - Single `ChatMessageBubble variant="ghost"` containing `ChatToolCalls calls={[{ name: "history", target: "Chat history", status: "running" }]}` — verbatim the `/mockups` Option B props.
  - No user turn, no metadata bars, no follow-ups, no artifact panel, no `isStreaming`.
- Delete `ThreadSkeleton.tsx`. (Git records the rename intent via the commit message; no re-export shim — the old name must not survive to confuse future readers.)

### FR2: `ThreadView` mechanical swap only (`ThreadView.tsx` import + JSX tag)

- Replace the `ThreadSkeleton` import with `ThreadHistoryLoader` and the single `{showHistorySkeleton ? (<ThreadSkeleton />) : …}` usage (`ThreadView.tsx:1840-1843`) with `<ThreadHistoryLoader />`.
- The `showHistorySkeleton` condition itself is FROZEN — not restated, not re-derived.
- No other `ThreadView` line changes (send/stream/edit/regenerate/vote/find/composer paths untouched).

### FR3: `/mockups` baseline retirement (edit `ThreadLoaderMockups.tsx` only)

- The "Baseline — current skeleton" section imported `ThreadSkeleton`, which no longer exists: remove that section + import. The page keeps A/B/C (B now marked as the shipped choice — update its `body` copy to say so).
- The `/mockups` route itself stays (dev-only exploration surface).

### FR4: No other behavior change

Predicates, `loadChatMessages` wiring, `isHistoryLoading` plumbing, `ConversationItem` Spinners, toasts, shortcuts, search, composer gating, and thread interaction logic are untouched.

## 7. Acceptance criteria

- [ ] AC1: Throttled history load shows one assistant row with a running chip (spinner animating frame one, "history / Chat history" text) → real turns, list only grows; deep-link pending and `!isAppReady` gate use the same row.
- [ ] AC2: Screen reader announces loading (chip `role="status"`); reduced-motion shows slowed spinner + text (no frozen bars anywhere in the thread).
- [ ] AC3: Guest + demo + ready-empty show zero loaders and fire zero chat fetches.
- [ ] AC4: Forced history failure keeps memory paint + exactly one existing toast.
- [ ] AC5: `npm.cmd test` + `npm.cmd run astro -- check` + `npm.cmd run build` + `git diff --check` pass; existing skeleton predicate tests pass unmodified; no reference to `ThreadSkeleton` remains (`grep` clean).
- [ ] AC6: Astryx UI/theme/copy/layout unchanged; desktop + <=640px; clean console.

## 8. Constraints

- `AGENTS.md` UI rules apply in full. Max five touched source files (expected: three — delete one, add one, edit two).
- Work from main; single branch (see plan); no commit/push unless asked.
- Synthetic fixtures only; no PII in tests.

## 9. API / interface requirements

- `ThreadHistoryLoader()` — presentational only, no fetching; `aria-busy` + `aria-label="Loading chat history"`.
- `session.ts` predicates and `chat-sync.ts`/backend contracts are FROZEN (consume, never edit).

## 10. Data requirements

- None. No schema/migration. No storage keys.

## 11. Security requirements

- No tokens/PII in loaders, logs, or tests. Identity-scoped message-load states unchanged.

## 12. Testing requirements

- No new test file (no component harness in this repo; predicate coverage passes unmodified, never rewrite assertions).
- Browser (user-assisted): F1/F2/F3 on desktop + narrow; throttled history load to observe the chip; reduced-motion + SR spot-check if feasible; clean console.

## 13. Rollout / rollback

- Rollout: frontend-only, single branch. No flag/env/migration.
- Rollback: revert branch; behavior returns to the 3-turn bar template. No data impact.
