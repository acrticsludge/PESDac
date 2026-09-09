# Plan: chat skeleton loading states (4 parallel streams)

Spec: `docs/reasonix/specs/chat-skeleton-loading.md` (FROZEN — streams build against it; defects become reports, never unilateral edits).
Status: Proposed.
Branch rule: one branch per stream from main; never commit to main; do not push/commit unless the user explicitly asks.

## Stream file-ownership (exclusive — a stream touching another stream's files stops and reports)

| Stream | Branch | Owns (ONLY these) | Must NEVER touch |
|---|---|---|---|
| A state + predicates | `feat/chat-skeleton-state` | `frontend/src/lib/session.ts` (append-only), `frontend/tests/chat-skeleton-predicates.test.ts` (new) | `Pesdac.tsx`, `ThreadView.tsx`, `chat-sync.ts`, backend, theme, CSS |
| B sidebar skeleton | `feat/chat-skeleton-sidebar` | `frontend/src/components/chat/ChatListSkeleton.tsx` (new), `frontend/src/components/Pesdac.tsx` (Subjects/Pinned/Archived block + imports only), `frontend/tests/chat-list-skeleton.test.ts` (new) | `session.ts`, `ThreadView.tsx`, `chat-sync.ts`, backend |
| C thread skeleton | `feat/chat-skeleton-thread` | `frontend/src/components/chat/ThreadSkeleton.tsx` (new), `frontend/src/components/chat/ThreadView.tsx` (SkeletonThread + showHistorySkeleton + ChatMessageList block only), no new test file (component has no node harness; predicate coverage lives in A) | `session.ts`, `Pesdac.tsx`, `chat-sync.ts`, backend |
| D composer skeleton + infrastructure | `feat/chat-skeleton-composer` | `frontend/src/components/chat/ComposerSkeleton.tsx` (new), `frontend/src/components/Pesdac.tsx` (welcome composer skeleton swap), `frontend/astro.config.mjs` (Vite optimizeDeps), `frontend/src/components/Providers.tsx` (LayerProvider), no new test file | `session.ts`, `ThreadView.tsx`, `chat-sync.ts`, backend |

## Dependency order

```text
FROZEN contract (this plan + spec §6) ─┬─ A (state: flag + predicates + tests)
                                        ├─ B (sidebar UI: imports A's symbols, never edits session.ts)
                                        ├─ C (thread UI: imports A's symbols, never edits session.ts)
                                        └─ D (composer + infra: imports A's symbols, never edits session.ts)
A + B + C + D run in parallel, zero conflict surface (disjoint file sets, disjoint suites). A is small by design.
```

B/C/D code against the frozen signatures from the start (`getChatHydratePending`, `shouldShowChatListSkeleton`, `shouldShowThreadSkeleton`). If A's merge has not landed on their base, they keep the documented heuristic fallback line and note it for the rebase — they do NOT stub `session.ts`.

## My merge procedure (lead reviewer = me, after all streams land)

1. Merge A → main (predicate tests + `astro check` green).
2. Rebase B onto new main; swap its heuristic fallback for the predicate call; re-run its gates.
3. Rebase C onto new main; same swap; re-run its gates.
4. Rebase D onto new main; same swap; re-run its gates.
5. Full gates: `npm.cmd test` (frontend), `npm.cmd run astro -- check`, `npm.cmd run build`, `git diff --check`.
6. User-assisted browser matrix:
   - F1: authed 1-chat refresh → 1 skeleton row per category (within collapsible) → name, no shift
   - F2: open/switch → 3-turn template (user/assistant/assistant) → real turns; composer live
   - F3: guest + demo: zero skeletons, zero fetches
   - F4: forced hydrate/history failure → memory + one toast each
   - F5: /new page → composer skeleton shows granular loading (placeholder text, icons), not full area
   - Narrow viewport, clean console, no 504s

## File touch budget

- Max five touched source files per stream (expected: A two, B three, C two, D three). Exceeding it means the stream was mis-scoped — split and report.

## Detailed fixes per stream

### Stream A: State + Predicates (unchanged)
- Add `chatHydratePending` flag with `getChatHydratePending()` / `setChatHydratePending(b)` (emit on set)
- Add predicates: `shouldShowChatListSkeleton(authStatus, hydratePending, customCount)`, `shouldShowThreadSkeleton(isBacked, msgStatus, overlayLen, explicitFlag?)`
- Pure, unit-testable (node:test, no DOM lib)

### Stream B: Sidebar Skeleton — FIXED PLACEMENT
- New `ChatListSkeleton.tsx`: renders `rows` placeholder rows in a `VStack gap={0.5}` container (mirrors `ConversationItem`: icon 20×20, label 140×14, menu dot 16×16)
- **CRITICAL**: Render *inside* each workspace's collapsible `VStack` (not at Subjects section level)
  - Current bug: `ChatGateSkeletons` at line 1635 renders as sibling to demoChats, not inside collapsible
  - Fix: Move skeleton rendering inside the collapsible's `VStack` where `workspaceCustoms` map
- `rows = customs.length > 0 ? 0 : pending ? clamp(lastKnown ?? 1, 1, 3) : 0`
- Pinned/Archived sections: render skeletons inside their `VStack` (same pattern)
- Search box stays live

### Stream C: Thread Skeleton — FIXED STYLE
- New `ThreadSkeleton.tsx`: renders 3-turn template per spec FR2:
  - Turn 1 (user): `ChatMessage` + `Avatar` + `ChatMessageBubble variant="ghost"` + `VStack gap={2}` → `Skeleton width={180} height={12}` + `Skeleton width={120} height={12}`
  - Turn 2 (assistant): `ChatMessage` + `Avatar` + `ChatMessageBubble variant="ghost"` + `VStack gap={2}` → `Skeleton width={280} height={12}` + `Skeleton width={200} height={12}` + `ChatMessageMetadata` skeleton (96×10)
  - Turn 3 (assistant): same as Turn 2 but `width={220}` + metadata skeleton
  - Toolcall-shape row (160×32 r2) ONLY when loading chat provably had toolcalls
- `ThreadView.tsx`: `SkeletonThread` becomes thin wrapper over `ThreadSkeleton`; `showHistorySkeleton` keeps `overlay.length === 0` memory-wins rule OR explicit flag
- `aria-busy`, `aria-label="Loading chat history"`

### Stream D: Composer Skeleton + Infrastructure
- **ComposerSkeleton.tsx**: Granular skeleton for welcome composer:
  - Placeholder text skeleton (where "Ask anything..." renders)
  - Suggestion card skeletons (where suggestion pills render)
  - Reference menu icon skeleton
  - Attach menu icon skeleton
  - Mode selector skeleton
  - Dictation button skeleton
  - **NOT** a full-area skeleton — each component skeletons independently
- **Pesdac.tsx**: Welcome composer uses `ComposerSkeleton` when `!isUserReady` (replaces current full-area skeleton)
- **Vite optimizeDeps fix** (`astro.config.mjs`): Add `optimizeDeps: { include: ['@astryxdesign/core', '@astryxdesign/theme-neutral', '@heroicons/react/24/outline', 'cobe'] }` to prevent 504 "Outdated Optimize Dep"
- **LayerProvider**: Ensure `LayerProvider` wraps app in `AppShell` (already present at line 1344) — verify toast viewport works; if not, add explicit `LayerProvider` at app root

## Risks

- B/C/D import symbols that do not exist on their pre-A base → handled by the documented fallback + rebase swap; any other drift means the contract was violated — stop and report.
- Row-count estimation after refresh is unknowable (memory wiped) → default 1, cap 3; do NOT fake Pinned/Archived sections to fill space.
- Thread template claiming toolcall shape without evidence → forbidden; toolcall-shape row only with proof (see spec FR3).
- Someone "improves" the fixed 2-bubble skeleton into a spinner/overlay/modal → forbidden; ditto-inside-real-shells only.
- Custom-chat refresh landing on welcome (no deep link) surprises the reporter → expected, documented non-goal; the sidebar skeleton is the coverage.
- **Skeleton placement**: Must render inside each workspace collapsible, not at section level — verify by expanding/collapsing during load.
- **Composer skeleton**: Must be granular, not full-area — verify each icon/text skeletons independently.
- **504 errors**: Vite optimizeDeps must include all Astryx + Heroicons deps; test with clean dev server restart.
- **Hydration mismatch**: Ensure SSR/Client branches match — no `typeof window` in skeleton components, no random values.