# Send-Path Plan

Status: Implemented. Spec: `docs/reasonix/specs/send-path.md`.

## Task 1: Store + responder (independent)

**Description:** `src/lib/session.ts` (CustomChat, localStorage chats/overlays,
listener hook, collision-free code gen) + `src/lib/responder.ts`
(deterministic `planResponse`). Widen `ToolCall.status` to
`"running" | "complete"`.
**Acceptance:** Imports resolve; no window access at module scope.
**Verify:** `astro build`.
**Files:** `src/lib/session.ts` (new), `src/lib/responder.ts` (new), `src/content/threads/types.ts`

## Task 2: ThreadView live turn

**Description:** `sessionKey` prop; overlay merge; send pipeline (user block →
running tools → word streaming → persisted assistant block); stop keeps
partial; timer cleanup on unmount; composer `onSubmit`/`isStopShown`/`onStop`.
**Acceptance:** Demo thread accepts sends; reload restores overlay.
**Verify:** build + HTTP spot-check (composer props serialized).
**Files:** `src/components/chat/ThreadView.tsx`

## Task 3: Welcome send + sidebar customs + New-chat

**Description:** `Pesdac.tsx`: welcome `onSubmit` → create + draft view
(synthetic thread); customs listed per subject group; custom click loads
in-place; `startNewChat` → clear + `/new` (no-op when there).
**Acceptance:** `/new` send creates sidebar chat; New chat always lands `/new`.
**Verify:** build + HTTP (`/new` welcome intact).
**Files:** `src/components/Pesdac.tsx`

## Checkpoint

- [ ] Build green; manual QA: send/stop/reload/new-chat/sidebar-click
- [ ] No visual regression on scripted threads

## Risks

| Risk | Mitigation |
|------|------------|
| Hydration mismatch (store vs SSR) | Server returns empty; client fills in `useEffect` |
| Timer leaks on navigation | Cleared on unmount; full-page nav drops them anyway |
| Scope creep (errors/uploads) | Explicitly deferred in spec |

## Rollback

Per file via git checkout; additive files removable outright.
