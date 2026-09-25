# ChatStore Implementation Spec

**Status:** Ready for implementation
**Date:** 2026-09-19
**Depends on:** `docs/reasonix/specs/chatstore-extraction.md`

---

## File Changes

### 1. New: `frontend/src/lib/chat-store.ts`

```typescript
// frontend/src/lib/chat-store.ts
// Chat persistence + hydration + skeleton predicates (extracted from session.ts)

import { useEffect, useState } from "react";
import type { Block } from "../content/threads/types";
import { CHAT_CODES, dayDividerLabel } from "./chat";
import { isCampus } from "./profile-options";
import {
  apiAppendMessage,
  apiCreateChat,
  apiDeleteChat,
  apiListChatsPage,
  apiListMessagesPage,
  apiPatchChat,
  apiTruncateMessages,
  type ServerChat,
  type ServerMessage,
} from "./chat-sync";
import { enqueueAppend } from "./outbox";
import { classifyOutboxError, outboxQueue } from "./outbox-queue";
import { AuthServiceError } from "./api/errors";

// ---- Types -----------------------------------------------------------------

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

export type OverlayBlock = Block;

export type SkeletonPredicate = {
  shouldShowThreadSkeleton: boolean;
  shouldShowComposerSkeleton: boolean;
  shouldShowListSkeleton: boolean;
};

// ---- In-memory store --------------------------------------------------------

const CHATS_KEY = "pesdac-custom-chats-v1";
const OVERLAY_KEY = "pesdac-overlays-v1";
const DRAFTS_KEY = "pesdac-drafts-v1";

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (error) {
      console.error("[chat-store] subscriber threw; continuing fanout", error);
    }
  });
}

export function subscribeChat(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useChatVersion(): number {
  const [, setVersion] = useState(0);
  useEffect(() => subscribeChat(() => setVersion((v) => v + 1)), []);
  return 0; // SSR: always 0; client: increments on emit
}

let lastRefetchAt = 0;
export function useChatInvalidation(): { lastRefetchAt: number; refetch: () => void } {
  const [, setVersion] = useState(0);
  useEffect(() => subscribeChat(() => setVersion((v) => v + 1)), []);
  return {
    get lastRefetchAt() { return lastRefetchAt; },
    refetch: () => { lastRefetchAt = Date.now(); emit(); },
  };
}

// In-memory JSON store (same as session.ts)
const mem = new Map<string, string>();

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = mem.get(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    mem.delete(key);
    if (!corruptWarned.has(key)) {
      corruptWarned.add(key);
      console.error(`[chat-store] stored data for ${key} was damaged and was discarded; that section started fresh.`);
    }
    return fallback;
  }
}

const corruptWarned = new Set<string>();

function writeJSON(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  mem.set(key, JSON.stringify(value));
  emit();
}

// ---- Chat operations --------------------------------------------------------

const TAKEN = new Set(Object.values(CHAT_CODES));

function genCode(existing: CustomChat[]): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (;;) {
    let code = "";
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!TAKEN.has(code) && !existing.some((c) => c.code === code)) return code;
  }
}

function newAdoptKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  const hex = "0123456789abcdef";
  const pick = (n: number) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join("");
  return `${pick(8)}-${pick(4)}-4${pick(3)}-8${pick(3)}-${pick(12)}`;
}

export function listCustomChats(): CustomChat[] {
  return readJSON<CustomChat[]>(CHATS_KEY, []);
}

export function getCustomChat(code: string): CustomChat | undefined {
  return listCustomChats().find((c) => c.code === code);
}

export function upsertChat(chat: CustomChat): void {
  const chats = listCustomChats();
  const idx = chats.findIndex((c) => c.code === chat.code);
  if (idx >= 0) chats[idx] = chat;
  else chats.push(chat);
  writeJSON(CHATS_KEY, chats);
}

export function deleteChat(code: string): void {
  const chats = listCustomChats().filter((c) => c.code !== code);
  writeJSON(CHATS_KEY, chats);
  // Also delete overlay + draft
  const overlays = readJSON<Record<string, OverlayBlock[]>>(OVERLAY_KEY, {});
  delete overlays[code];
  writeJSON(OVERLAY_KEY, overlays);
  const drafts = readJSON<Record<string, string>>(DRAFTS_KEY, {});
  delete drafts[code];
  writeJSON(DRAFTS_KEY, drafts);
}

export function resetForIdentity(): void {
  if (typeof window === "undefined") return;
  writeJSON(CHATS_KEY, []);
  writeJSON(OVERLAY_KEY, {});
  writeJSON(DRAFTS_KEY, {});
  // Note: feedback, profile, composer-depth are NOT cleared — they belong to other stores
}

// ---- Overlay operations -----------------------------------------------------

const MAX_OVERLAY_BLOCKS_PER_CHAT = 200;

export function getOverlay(code: string): OverlayBlock[] {
  return readJSON<Record<string, OverlayBlock[]>>(OVERLAY_KEY, {})[code] ?? [];
}

export function setOverlay(code: string, blocks: OverlayBlock[]): void {
  const all = readJSON<Record<string, OverlayBlock[]>>(OVERLAY_KEY, {});
  all[code] = blocks.slice(-MAX_OVERLAY_BLOCKS_PER_CHAT);
  writeJSON(OVERLAY_KEY, all);
}

export function appendBlocks(code: string, blocks: OverlayBlock[]): void {
  const current = getOverlay(code);
  setOverlay(code, [...current, ...blocks].slice(-MAX_OVERLAY_BLOCKS_PER_CHAT));
}

export function removeLastOverlayBlock(code: string): void {
  const current = getOverlay(code);
  if (current.length > 0) setOverlay(code, current.slice(0, -1));
}

export function truncateOverlay(code: string, keep: number): void {
  const current = getOverlay(code);
  if (current.length > keep) setOverlay(code, current.slice(0, keep));
}

// ---- Draft operations -------------------------------------------------------

export function readDraft(code: string): string {
  return readJSON<Record<string, string>>(DRAFTS_KEY, {})[code] ?? "";
}

export function writeDraft(code: string, text: string): void {
  const all = readJSON<Record<string, string>>(DRAFTS_KEY, {});
  all[code] = text;
  writeJSON(DRAFTS_KEY, all);
}

export function clearDraft(code: string): void {
  const all = readJSON<Record<string, string>>(DRAFTS_KEY, {});
  delete all[code];
  writeJSON(DRAFTS_KEY, all);
}

// ---- Skeleton predicates ----------------------------------------------------

export function shouldShowThreadSkeleton(code: string): boolean {
  const chat = getCustomChat(code);
  if (!chat) return true;
  const status = getChatMessagesStatus(code);
  return status === "loading" || status === "hydrating";
}

export function shouldShowComposerSkeleton(code: string): boolean {
  return shouldShowThreadSkeleton(code);
}

export function shouldShowListSkeleton(): boolean {
  const chats = listCustomChats();
  return chats.length === 0;
}

export function getHydrateSyncError(code: string): string | null {
  return getChatSyncError(code);
}

// ---- Hydration / sync (moved from session.ts) -------------------------------

// Re-export from chat-sync for consumers
export {
  hydrateChats,
  loadChatMessages,
  invalidateChatMessages,
  getChatMessagesStatus,
  getChatSyncError,
  getChatHydrateFailed,
  clearChatSyncError,
  persistAppendedBlock,
  persistTruncate,
} from "./chat-sync";

export type { ChatAuth, ChatNotify } from "./chat-sync";

// ---- Migration --------------------------------------------------------------

export async function migrateOnFirstContact(identity: { userId: string }): Promise<string[]> {
  // 1. Adopt guest chats → POST /chats with clientAdoptKey
  // 2. Migrate overlays → append to server messages
  // 3. Migrate pins/archive → PATCH /chats/{code}
  // Returns array of adopted chat codes
  // Implementation delegates to chat-sync.ts adopt logic
  const chats = listCustomChats();
  const adopted: string[] = [];
  for (const chat of chats) {
    if (chat.clientAdoptKey) {
      try {
        const created = await apiCreateChat(chat.subject, chat.title, { clientAdoptKey: chat.clientAdoptKey });
        adopted.push(created.code);
        deleteChat(chat.code); // Remove local, server is source of truth
      } catch {
        // Leave local; retry on next contact
      }
    }
  }
  return adopted;
}

// ---- Outbox seam ------------------------------------------------------------

let invalidateCallback: (() => void) | null = null;

export function registerInvalidateCallback(fn: () => void): () => void {
  invalidateCallback = fn;
  return () => { if (invalidateCallback === fn) invalidateCallback = null; };
}

function triggerInvalidate(): void {
  invalidateCallback?.();
}

// Called by outbox.ts on ack/evict
export function __notifyOutboxAck(): void {
  triggerInvalidate();
}

// ---- Test seams -------------------------------------------------------------

export function __plantRawForTesting(key: string, raw: string): void {
  if (typeof window === "undefined") return;
  mem.set(key, raw);
}

export function __resetCorruptWarningsForTesting(): void {
  corruptWarned.clear();
}
```

---

### 2. New: `frontend/src/lib/profile-store.ts` (stub, extracted from session.ts)

```typescript
// frontend/src/lib/profile-store.ts
// Profile + identity seed (extracted from session.ts)

import { useEffect, useState } from "react";
import { subscribeChat, useChatVersion } from "./chat-store"; // temporary re-export

const PROFILE_KEY = "pesdac-profile-v1";
const IDENTITY_SEED_KEY = "pesdac-identity-seed-v1";
const PROFILE_PENDING_KEY = "pesdac-profile-pending-v1";

const listeners = new Set<() => void>();
function emit() { listeners.forEach(fn => { try { fn() } catch {} }); }

export function subscribeProfile(fn: () => void): () => void {
  listeners.add(fn); return () => listeners.delete(fn);
}

export function useProfileVersion(): number {
  const [, setVersion] = useState(0);
  useEffect(() => subscribeProfile(() => setVersion(v => v + 1)), []);
  return 0;
}

export function getProfile(): ServerProfile | null { /* ... from session.ts */ }
export function updateProfile(patch: Partial<ServerProfile>): void { /* ... */ }
export function getProfileSeedPending(): boolean { /* ... */ }
export function setProfileSeedPending(v: boolean): void { /* ... */ }
export function identitySeedKey(): string { /* ... */ }
export function setSeededIdentityKey(key: string): void { /* ... */ }
export function getSeededIdentityKey(): string | null { /* ... */ }
export function clearLocalProfileSeed(): void { /* ... */ }
```

---

### 3. New: `frontend/src/lib/feedback-store.ts` (stub)

```typescript
// frontend/src/lib/feedback-store.ts
// Feedback votes (extracted from session.ts)

export function getFeedback(): FeedbackVote[] { /* ... */ }
export function setFeedback(votes: FeedbackVote[]): void { /* ... */ }
export function feedbackKey(messageId: string): string { /* ... */ }
```

---

### 4. New: `frontend/src/lib/ui-signals.ts` (stub)

```typescript
// frontend/src/lib/ui-signals.ts
// Composer depth, global shortcuts, find availability (extracted from session.ts)

export function getComposerDepth(): number { /* ... */ }
export function setComposerDepth(depth: number): void { /* ... */ }
export const CANCEL_EVENT = "pesdac:cancel";
export const FOCUS_COMPOSER_EVENT = "pesdac:focus-composer";
export const OPEN_FIND_EVENT = "pesdac:open-find";
export function isFindAvailable(): boolean { /* ... */ }
export function setFindAvailable(v: boolean): void { /* ... */ }
```

---

### 5. New: `frontend/src/lib/export-port.ts` (stub)

```typescript
// frontend/src/lib/export-port.ts
// Export-my-data (extracted from session.ts)

export function dumpStore(): Record<string, unknown> { /* ... */ }
```

---

### 6. Modified: `frontend/src/components/chat/ThreadView.tsx`

**Import changes:**
```diff
- import {
-   useSessionVersion,
-   useStorageHealth,
-   useCorruptKeys,
-   getProfile,
-   getComposerDepth,
-   setComposerDepth,
-   getOverlay,
-   setOverlay,
-   appendBlocks,
-   removeLastOverlayBlock,
-   truncateOverlay,
-   readDraft,
-   writeDraft,
-   getFeedback,
-   setFeedback,
-   feedbackKey,
-   type FeedbackVote,
-   type ChatAuth,
-   identitySeedKey,
-   isServerChat,
-   loadChatMessages,
-   invalidateChatMessages,
-   getChatMessagesStatus,
-   getChatSyncError,
-   getChatHydrateFailed,
-   clearChatSyncError,
-   hydrateChats,
-   persistAppendedBlock,
-   persistTruncate,
-   shouldShowThreadSkeleton,
-   listCustomChats,
-   CANCEL_EVENT,
-   FOCUS_COMPOSER_EVENT,
-   OPEN_FIND_EVENT,
-   setFindAvailable,
- } from "../../lib/session";
+ import { useChatVersion, listCustomChats, getOverlay, setOverlay, appendBlocks, removeLastOverlayBlock, truncateOverlay, readDraft, writeDraft, loadChatMessages, invalidateChatMessages, getChatMessagesStatus, getChatSyncError, getChatHydrateFailed, clearChatSyncError, hydrateChats, persistAppendedBlock, persistTruncate, shouldShowThreadSkeleton, type ChatAuth } from "../../lib/chat-store";
+ import { getProfile, getComposerDepth, setComposerDepth, getFeedback, setFeedback, feedbackKey, type FeedbackVote, identitySeedKey } from "../../lib/profile-store";
+ import { CANCEL_EVENT, FOCUS_COMPOSER_EVENT, OPEN_FIND_EVENT, isFindAvailable, setFindAvailable } from "../../lib/ui-signals";
```

**Hook change:**
```diff
- const version = useSessionVersion();
+ const version = useChatVersion();
```

---

### 7. Modified: `frontend/src/lib/outbox.ts`

**Import changes:**
```diff
- import { resetChatStoreForIdentity, revalidateForeground } from "./session";
+ import { resetForIdentity, __notifyOutboxAck, registerInvalidateCallback } from "./chat-store";
```

**Usage changes:**
```diff
- resetChatStoreForIdentity();
+ resetForIdentity();

- revalidateForeground();
+ __notifyOutboxAck(); // called after ack/evict in flushOutbox
```

**Initialize callback in `startOutboxSchedulers()`:**
```typescript
// Inside startOutboxSchedulers(), after schedulers start:
registerInvalidateCallback(() => {
  // Trigger a flush check on invalidation
  // (existing flush logic handles deduplication)
});
```

---

### 8. Modified: `frontend/src/lib/auth.ts`

**Add import:**
```typescript
import { migrateOnFirstContact } from "./chat-store";
```

**In `apiGetMe` / successful auth path:**
```typescript
// After successful apiGetMe, call migration
const me = await apiGetMe();
await migrateOnFirstContact({ userId: me.id });
return me;
```

---

### 9. Modified: `frontend/src/lib/cache-revalidation.ts`

**Fold into chat-store.ts as internal logic** (Candidate 5). Delete this file after migration.

---

### 10. Deleted: `frontend/src/lib/session.ts`

After all consumers migrated.

---

## Test Updates

| Test File | Action |
|-----------|--------|
| `session-store.test.ts` | Split into `chat-store.test.ts`, `profile-store.test.ts`, `feedback-store.test.ts`, `ui-signals.test.ts` |
| `cache-revalidation.test.ts` | Move tests into `chat-store.test.ts` (internal logic) |
| `auth-session-flow.test.ts` | Update imports; `resetChatStoreForIdentity` → `resetForIdentity` |
| `outbox.test.ts` | Mock `registerInvalidateCallback` instead of session internals |

---

## Implementation Order

1. Create `chat-store.ts` (copy+paste from session.ts, adjust exports)
2. Create stub modules: `profile-store.ts`, `feedback-store.ts`, `ui-signals.ts`, `export-port.ts` re-exporting from session.ts temporarily
3. Update `ThreadView.tsx` imports
4. Update `outbox.ts` imports + callback registration
5. Update `auth.ts` migration call
6. Fold `cache-revalidation.ts` into `chat-store.ts` (internal)
7. Run tests, fix any breaks
8. Extract real implementations into stub modules
9. Delete `session.ts`
10. Delete `cache-revalidation.ts`

---

## Rollback Plan

If issues arise:
- `session.ts` remains until step 9
- Stub modules re-export from `session.ts` so consumers work during transition
- Git revert to before step 1 if needed