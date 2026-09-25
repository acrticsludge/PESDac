# ChatStore Extraction — Design Spec

**Status:** Proposed
**Date:** 2026-09-19
**Parent:** Architecture review candidate 1 (Collapse Client Session module)

---

## Decisions

| # | Question | Decision | Rationale |
|---|----------|----------|-----------|
| 1 | `emit()` listener fanout ownership | **ChatStore owns it** — single source of reactivity for chat/overlay/draft state. Other modules (ProfileStore, FeedbackStore) get their own `emit`. | Locality: chat mutations → chat listeners. No cross-domain fanout. |
| 2 | Identity seed / cross-tab logout | **Moves to ProfileStore** — it's identity-scoped, not chat-scoped. | ADR 0003: identity seed keys (`pesdac-profile-v1`, `identitySeedKey`) are profile-domain. |
| 3 | `useSessionVersion()` hook | **Per-module `use*Version()`** — `useChatVersion()`, `useProfileVersion()`, `useFeedbackVersion()`, `useUIVersion()`. | Granular reactivity: ThreadView re-renders only when chats change, not when profile changes. |
| 4 | Test seams (`__plantStoreRawForTesting`, `__resetCorruptWarningsForTesting`) | **Move to ChatStore** as `ChatStore.__plantRawForTesting()`, `ChatStore.__resetCorruptWarningsForTesting()`. | Tests exercise ChatStore directly; no central helper needed. |
| 5 | Outbox callback interface | **ChatStore exports `registerInvalidateCallback(fn)`** — called by `outbox.ts` on ack/evict. One callback, not per-key. | Narrow seam: outbox doesn't know chat internals, just "something changed, revalidate". |
| 6 | ADR 0003 migrate-on-contact logic | **ChatStore owns `migrateOnFirstContact(identity)`** — called from `auth.ts` after successful `apiGetMe`. Returns migrated chat codes. | Single owner of chat migration. ProfileStore owns profile migration. |
| 7 | SSR-safe contract | **Preserved** — ChatStore returns empty arrays/objects on server; hydration via `useChatVersion()` after island mounts. | Existing pattern works; no new complexity. |

---

## ChatStore Interface

```typescript
// frontend/src/lib/chat-store.ts (new module)

/** Chat container — matches ServerChat + local-only fields */
export type CustomChat = {
  code: string;
  subject: string;
  title: string;
  createdAt: string;
  isPinned?: boolean;
  isArchived?: boolean;
  updatedAt?: string;
  clientAdoptKey?: string;
};

/** Overlay block (message annotation) */
export type OverlayBlock = { /* existing Block type from threads/types */ };

/** Public interface — narrow, stable */
export interface ChatStore {
  // ---- Reactive reads (SSR-safe: empty on server) ----
  listChats(): CustomChat[];
  getChat(code: string): CustomChat | undefined;
  getOverlay(code: string): OverlayBlock[];
  getDraft(code: string): string;
  getSkeletonPredicate(code: string): SkeletonPredicate;

  // ---- Mutations (emit via useChatVersion) ----
  upsertChat(chat: CustomChat): void;
  deleteChat(code: string): void;
  setOverlay(code: string, blocks: OverlayBlock[]): void;
  appendOverlay(code: string, blocks: OverlayBlock[]): void;
  setDraft(code: string, text: string): void;
  clearDraft(code: string): void;

  // ---- Hydration / sync (called by ThreadController) ----
  hydrateChats(auth: ChatAuth): Promise<void>;
  loadChatMessages(code: string, auth: ChatAuth): Promise<void>;
  invalidateChatMessages(code: string): void;

  // ---- Migration (called by Auth module on login) ----
  migrateOnFirstContact(identity: { userId: string }): Promise<string[]>;

  // ---- Outbox seam (narrow callback) ----
  registerInvalidateCallback(fn: () => void): () => void;

  // ---- Reactivity hook ----
  useChatVersion(): number;

  // ---- Test seams ----
  __plantRawForTesting(key: string, raw: string): void;
  __resetCorruptWarningsForTesting(): void;
}

/** Skeleton predicate types (moved from session.ts) */
export type SkeletonPredicate = {
  shouldShowThreadSkeleton: boolean;
  shouldShowComposerSkeleton: boolean;
  shouldShowListSkeleton: boolean;
};
```

---

## Module Map (Before → After)

| Current (session.ts) | New Home |
|---------------------|----------|
| `listCustomChats`, `getCustomChat`, `upsertChat`, `deleteChat`, `adoptGuestChats` | **ChatStore** |
| `getOverlay`, `setOverlay`, `appendBlocks`, `removeLastOverlayBlock`, `truncateOverlay`, `MAX_OVERLAY_BLOCKS_PER_CHAT` | **ChatStore** |
| `readDraft`, `writeDraft`, `clearDraft`, `DRAFTS_KEY` | **ChatStore** |
| `hydrateChats`, `loadChatMessages`, `invalidateChatMessages`, `getChatMessagesStatus`, `getChatSyncError`, `getChatHydrateFailed`, `clearChatSyncError`, `persistAppendedBlock`, `persistTruncate` | **ChatStore** |
| `shouldShowThreadSkeleton`, `shouldShowComposerSkeleton`, `shouldShowListSkeleton`, `getHydrateSyncError` | **ChatStore** |
| `resetChatStoreForIdentity` | **ChatStore** (renamed `resetForIdentity`) |
| `revalidateForeground` | **ChatStore** (internal; called via `registerInvalidateCallback`) |
| `broadcastLogoutPing` receiver | **ChatStore** (internal listener) |
| `subscribeSession`, `useSessionVersion` | **ChatStore** → `subscribeChat`, `useChatVersion` |
| `identitySeedKey`, `setSeededIdentityKey`, `getSeededIdentityKey`, `clearLocalProfileSeed` | **ProfileStore** |
| `getProfile`, `updateProfile`, `getProfileSeedPending`, `setProfileSeedPending` | **ProfileStore** |
| `getFeedback`, `setFeedback`, `feedbackKey`, `FEEDBACK_KEY` | **FeedbackStore** |
| `getComposerDepth`, `setComposerDepth`, `COMPOSER_DEPTH_KEY` | **UISignals** |
| `CANCEL_EVENT`, `FOCUS_COMPOSER_EVENT`, `OPEN_FIND_EVENT`, `isFindAvailable`, `setFindAvailable` | **UISignals** |
| `dumpStore` | **ExportPort** adapter |
| `__plantStoreRawForTesting`, `__resetCorruptWarningsForTesting` | **ChatStore** (test seams) |

---

## Migration Steps

1. **Create `frontend/src/lib/chat-store.ts`** with the interface above + implementation extracted from `session.ts`.
2. **Add `frontend/src/lib/profile-store.ts`**, `feedback-store.ts`, `ui-signals.ts`, `export-port.ts` as stubs re-exporting from `session.ts` temporarily.
3. **Update `ThreadView.tsx`** — replace 36 `session.ts` imports with ~8 from `chat-store.ts` + `profile-store.ts` + `ui-signals.ts`.
4. **Update `outbox.ts`** — replace `resetChatStoreForIdentity` + `revalidateForeground` imports with `ChatStore.registerInvalidateCallback`.
5. **Update `cache-revalidation.ts`** — fold into ChatStore as internal logic (Candidate 5).
6. **Update `auth.ts`** — call `ChatStore.migrateOnFirstContact()` after `apiGetMe` succeeds.
7. **Delete `session.ts`** once all consumers migrated.
8. **Update tests** — point to new modules; test seams renamed.

---

## Test Impact

| Test File | Change |
|-----------|--------|
| `session-store.test.ts` | Split into `chat-store.test.ts`, `profile-store.test.ts`, `feedback-store.test.ts`, `ui-signals.test.ts` |
| `cache-revalidation.test.ts` | Fold into `chat-store.test.ts` (internal logic) |
| `auth-session-flow.test.ts` | Update imports; `resetChatStoreForIdentity` → `ChatStore.resetForIdentity` |
| `outbox.test.ts` | Mock `ChatStore.registerInvalidateCallback` instead of session internals |

---

## ADR Alignment

- **ADR 0003 (Client Data Fate)** — ChatStore implements the "migrate" bucket for `pesdac-custom-chats-v1`, `pesdac-overlays-v1`; "drop" bucket for `pesdac-drafts-v1` (drafts stay local). Migration logic moves from `auth.ts`/`session.ts` into `ChatStore.migrateOnFirstContact()`.
- **ADR 0002 (BetterAuth ownership)** — Unchanged. ChatStore is consumer of BetterAuth identity, not owner.
- **No new ADR needed** — this is a refactor within the existing architecture.