# Chat error display — toast + composer status

Status: Proposed.
Date: 2026-09-10.
Scope: chat-area sync errors (history/hydrate/persist/create). No redesign, no theme change, no new UI lib (per `AGENTS.md`).

## 1. Problem

Chat sync failures surface as a transient toast only (`notifyChat` → `AppToasts`), then disappear:

* `frontend/src/lib/session.ts` — `hydrateChats` (`Couldn't load your chats…`, :1223), `loadChatMessages` (`Couldn't load this chat's history…`, :1082), `createChatBacked` (`Couldn't create that chat…`, :851), `persistAppendedBlock` (`Couldn't save that message…`, :1031), `persistTruncate` (`Couldn't update that chat…`, :1047), pin/archive/rename/delete variants.
* `frontend/src/components/Pesdac.tsx:600` — `notifyChat` bridge; welcome composer (`:1947`) only shows storage/corrupt warnings, never sync errors.
* `frontend/src/components/chat/ThreadView.tsx:1694` — composer `status` only covers `sendError` (rate-limit warning) + storage/corrupt warnings, never sync errors.

History loader can spin forever on a backend-down deep link:

1. `Pesdac.tsx:1874` — `deepLinkPending = draftCode != null && draftChat == null && !chatRowsLive`.
2. `Pesdac.tsx:1899` — `isHistoryLoading={provisionalThread != null}` stays `true`.
3. `ThreadView.tsx:790-793` — `showHistorySkeleton = !isAppReady || isHistoryLoading === true || shouldShowThreadSkeleton(...)` → stuck `true` → `ThreadHistoryLoader` forever.
4. On hydrate failure `hydrateChats` returns `kept-memory` without setting `chatHydratedKey` (`session.ts:1228`), so `chatReady()` stays false → `chatRowsLive` false forever; `chatHydratedRef` (`Pesdac.tsx:607-612`) blocks any retry.

Normal (non-provisional) history failure self-clears (`failed` ≠ `loading` in `shouldShowThreadSkeleton`, `session.ts:617`) but leaves no persistent surface after the toast fades.

## 2. Goal

Every chat sync failure → existing toast (unchanged) + persistent `ChatComposer.status` error; history spinner always terminates.

Reference (user-supplied Astryx pattern):

```tsx
<ChatComposer
  onSubmit={...}
  statusPosition="top"
  status={{ type: 'error', message: 'Failed to send message. Please try again.' }}
/>
```

## 3. Non-goals

* No visual redesign; keep `PESDacMockupTheme`, spacing, layout.
* No change to toast copy/position (`LayerProvider toast topStart`, `Pesdac.tsx:1535`).
* No change to turn-level `failed/empty/rate-limited` blocks (`error-states.md` contract stays).
* No sidebar error chrome; sidebar pin/archive/rename/delete keep toast-only.
* No 401 behavior change (`notifyFailure` stays silent, global `AUTH_REQUIRED_EVENT` owns it).

## 4. UX contract

* Error (backend/sync): `status={{ type: "error", message }} statusPosition="top"`.
* Warning (rate-limit, storage, corrupt): existing `{ type: "warning" }` bottom position, unchanged.
* Precedence (thread + welcome composer): `sendError > syncError > storage/corrupt`.
* Thread fallback scope (fix 2026-09-10): per-chat error wins; otherwise any
  authenticated thread composer falls back to the hydrate error (demo threads
  included — their turns still send memory-only). A failed hydrate means the
  list leg never landed, so no backed chat can exist; guests stay clean.
* Message copy reuses the existing toast strings (single source), e.g. history: `Couldn't load this chat's history. Showing what's on this device.`
* Error clears on: next successful send, successful history reload/hydrate, or chat switch (remount). Never on a timer.
* Failed history renders the memory paint + a Retry affordance; spinner never re-appears without a new fetch.

## 5. Changes

| # | File | What |
|---|---|---|
| 1 | `frontend/src/lib/session.ts` | Expose sync-error signal render-direct (same pattern as `getChatMessagesStatus`/`getChatHydratePending`): e.g. `getChatSyncError(key) → string \| null`, set wherever `notifyFailure` fires for hydrate/history/persist/create, cleared on success. Unblock hydrate retry (clear/stale-check `chatHydratedRef` gate on `kept-memory`). |
| 2 | `frontend/src/components/Pesdac.tsx` | Derive `hydrateFailed`; `isHistoryLoading={provisionalThread != null && !hydrateFailed}`; wire welcome `ChatComposer.status` error branch for create/hydrate failures (precedence above storage warnings). |
| 3 | `frontend/src/components/chat/ThreadView.tsx` | Merge sync error into existing `status={}` chain (`:1694`) with `statusPosition="top"` when error; suppress `ThreadHistoryLoader` when `historyStatus === "failed"` / sync error present; add history Retry (re-calls `loadChatMessages`). |
| 4 | Tests | `shouldShowThreadSkeleton` failed-case + provisional-hydrate-failed case (spinner off + error set). |

## 6. Acceptance

* Backend down → open deep link: one toast, spinner stops, thread composer shows top error, Retry re-attempts load.
* Backend down → send message: one toast, composer shows error, draft preserved, no duplicate user message on retry.
* Backend down → first paint on `/new`: one toast, welcome composer shows top error.
* Rate-limit/storage/corrupt states unchanged; 401 path still silent except global re-login.
* `pnpm typecheck`, targeted tests, `pnpm build` pass.

## 7. Rollback

Revert the three source files. Spec-only change until then — no schema, migration, or data impact.
