# ChatStore Extraction — Implementation Plan

**Status:** Ready to execute
**Date:** 2026-09-19
**Spec:** `docs/reasonix/specs/chatstore-implementation.md`

---

## Phase 1: Create New Modules (Day 1)

| Step | File | Action | Verification |
|------|------|--------|--------------|
| 1.1 | `frontend/src/lib/chat-store.ts` | Copy chat/overlay/draft/hydrate/skeleton logic from `session.ts`; export interface per spec | TypeScript compiles |
| 1.2 | `frontend/src/lib/profile-store.ts` | Stub re-exporting from `session.ts` temporarily | Imports work |
| 1.3 | `frontend/src/lib/feedback-store.ts` | Stub re-exporting from `session.ts` temporarily | Imports work |
| 1.4 | `frontend/src/lib/ui-signals.ts` | Stub re-exporting from `session.ts` temporarily | Imports work |
| 1.5 | `frontend/src/lib/export-port.ts` | Stub re-exporting from `session.ts` temporarily | Imports work |

**Gate:** All 5 modules import without errors. `session.ts` unchanged.

---

## Phase 2: Migrate Consumers (Day 1-2)

| Step | File | Action | Verification |
|------|------|--------|--------------|
| 2.1 | `frontend/src/components/chat/ThreadView.tsx` | Replace 36 `session.ts` imports with ~8 from new modules | TypeScript compiles; dev server loads |
| 2.2 | `frontend/src/lib/outbox.ts` | Replace `resetChatStoreForIdentity`/`revalidateForeground` with `resetForIdentity`/`registerInvalidateCallback` | TypeScript compiles |
| 2.3 | `frontend/src/lib/auth.ts` | Add `migrateOnFirstContact` call after successful `apiGetMe` (wrapped in try/catch) | TypeScript compiles |
| 2.4 | `frontend/src/lib/cache-revalidation.ts` | Fold `useCacheRevalidation` hook into `chat-store.ts` as `useChatInvalidation`; delete file | `App.tsx` imports from chat-store |
| 2.5 | `frontend/src/App.tsx` | Update import: `useCacheRevalidation` → `useChatInvalidation` from `chat-store` | Dev server loads |

**Gate:** `npm run dev` works; ThreadView renders; outbox flush triggers callback; auth login triggers migration; no console errors on `/new`.

---

## Phase 3: Test Migration (Day 2)

| Step | Test File | Action | Verification |
|------|-----------|--------|--------------|
| 3.1 | `tests/chat-store.test.ts` | New file: move chat/overlay/draft/skeleton tests from `session-store.test.ts` | `npm test` passes |
| 3.2 | `tests/profile-store.test.ts` | New file: move profile/identity tests | `npm test` passes |
| 3.3 | `tests/feedback-store.test.ts` | New file: move feedback tests | `npm test` passes |
| 3.4 | `tests/ui-signals.test.ts` | New file: move composer-depth/shortcuts/find tests | `npm test` passes |
| 3.5 | `tests/cache-revalidation.test.ts` | Move into `chat-store.test.ts` as internal logic tests | `npm test` passes |
| 3.6 | `tests/auth-session-flow.test.ts` | Update imports; `resetChatStoreForIdentity` → `resetForIdentity` | `npm test` passes |
| 3.7 | `tests/outbox.test.ts` | Mock `registerInvalidateCallback` | `npm test` passes |

**Gate:** Full test suite passes (`npm test`).

---

## Phase 3.5: SSR Hook Verification (Day 2)

| Step | File | Action | Verification |
|------|------|--------|--------------|
| 3.5.1 | `frontend/src/App.tsx` | Verify `useChatInvalidation` works in SSR (returns 0, no hydration mismatch) | Dev server loads; no console hydration errors |
| 3.5.2 | `frontend/src/components/chat/ThreadView.tsx` | Verify `useChatVersion` returns 0 on SSR | No hydration mismatch on `/new` |

---

## Phase 4: Extract Real Implementations (Day 2-3)

| Step | File | Action | Verification |
|------|------|--------|--------------|
| 4.1 | `profile-store.ts` | Replace stubs with real implementation from `session.ts` | Tests pass |
| 4.2 | `feedback-store.ts` | Replace stubs with real implementation | Tests pass |
| 4.3 | `ui-signals.ts` | Replace stubs with real implementation | Tests pass |
| 4.4 | `export-port.ts` | Replace stubs with real implementation | Tests pass |

**Gate:** All tests pass; no stubs remain.

---

## Phase 5: Cleanup (Day 3)

| Step | File | Action | Verification |
|------|------|--------|--------------|
| 5.1 | `frontend/src/lib/session.ts` | Delete | No imports remain |
| 5.2 | `frontend/src/lib/cache-revalidation.ts` | Delete | No imports remain |
| 5.3 | `tests/session-store.test.ts` | Delete | Test suite passes |

**Gate:** `npm run build` passes; `npm test` passes; no TypeScript errors.

---

## Impact Analysis

### Breaking Effects (Risk)

| Area | Risk | Mitigation |
|------|------|------------|
| **ThreadView.tsx** | 36 imports → 8; any missed import breaks dev server | Phase 1 stubs re-export from session.ts — zero behavior change until Phase 2 |
| **outbox.ts** | `resetChatStoreForIdentity` + `revalidateForeground` removed; outbox stops invalidating cache | `registerInvalidateCallback` registered in `startOutboxSchedulers` (Phase 2.2) — single line add |
| **auth.ts** | Migration call added after `apiGetMe`; if `migrateOnFirstContact` throws, login breaks | Wrap in try/catch; log and continue — migration is best-effort |
| **cache-revalidation.ts** | Deleted; `App.tsx` imports `useCacheRevalidation` hook | Fold hook into `chat-store.ts` as `useChatInvalidation` (Phase 2.4) — same API, internal impl |
| **E2E tests** | Playwright tests use `session.ts` internals via `__plantStoreRawForTesting` | Test seams moved to ChatStore with same names (Phase 1.1) |
| **SSR hydration** | `useChatVersion()` returns 0 on server (same as `useSessionVersion`) | No change — SSR contract preserved |

### Good Effects (Payoff)

| Area | Improvement | Measurable |
|------|-------------|------------|
| **Locality** | Chat mutations → ChatStore listeners only | ThreadView re-renders drop ~60% (profile/feedback changes no longer trigger) |
| **Interface** | 38 exports → 15 (ChatStore) + 4×3 (other stores) | Consumer imports: ThreadView 36→8, outbox 2→1, auth 1→1 |
| **Testability** | ChatStore testable in isolation; no session.ts mocking | Test file size: session-store 145 lines → chat-store ~80 + profile ~30 + feedback ~15 + ui ~10 |
| **Bundle** | Dead code elimination: profile/feedback/ui not bundled into ThreadView | Estimated ~2KB gz saved on ThreadView chunk |
| **ADR 0003 compliance** | Migration logic owns "migrate" bucket keys | Single source of truth for chat adoption |
| **Future** | ThreadController (Candidate 4) consumes ChatStore directly | No new seam needed |

---

## Rollback Triggers

| Trigger | Action |
|---------|--------|
| TypeScript errors in Phase 2 | Revert consumer changes; keep new modules |
| Test failures in Phase 3 | Fix in new modules; don't revert to session.ts |
| Dev server crashes | Revert `ThreadView.tsx` imports only |
| Outbox callback not firing | Check `registerInvalidateCallback` registration in `startOutboxSchedulers` |
| Hydration mismatch on `/new` | `useChatVersion`/`useChatInvalidation` returning non-zero on SSR — fix to return 0 |
| `App.tsx` cache invalidation broken | `useChatInvalidation` not exported from chat-store — add export |
| Auth login throws on migration | Wrap `migrateOnFirstContact` in try/catch; log and continue |

---

## Dependencies

- **No external deps** — pure refactor within frontend
- **ADR 0003** respected — migration logic moves to ChatStore
- **ADR 0002** unaffected — BetterAuth ownership unchanged
- **No backend changes** — `chat-sync.ts` API unchanged

---

## Success Criteria

- [ ] `session.ts` deleted
- [ ] `cache-revalidation.ts` deleted
- [ ] ThreadView imports ≤ 10 from lib modules
- [ ] ChatStore exports ≤ 15 symbols
- [ ] All existing tests pass
- [ ] New tests cover ChatStore interface
- [ ] `npm run build` succeeds
- [ ] Dev server loads `/new` and `/subject/*` routes