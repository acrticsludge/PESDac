# Plan: chat error display — toast + composer status (single stream)

Spec: `docs/reasonix/specs/chat-error-display.md` (FROZEN — the stream builds against it; defects become reports, never unilateral edits).
Status: Proposed.
Branch rule: one branch from main; never commit to main; do not push/commit unless the user explicitly asks.

## Stream (one — small by design)

| Stream | Branch | Owns (ONLY these) | Must NEVER touch |
|---|---|---|---|
| Chat sync errors | `feat/chat-error-display` | `frontend/src/lib/session.ts` (sync-error signal + hydrate-retry gate only), `frontend/src/components/Pesdac.tsx` (hydrate-failed derivation + welcome composer error branch), `frontend/src/components/chat/ThreadView.tsx` (thread composer error branch + loader suppression + history Retry), `frontend/tests/*chat*error*.test.ts` + `*thread*skeleton*.test.ts` (new/updated regression tests only) | `chat-sync.ts`, `lib/chat.ts`, `AppToasts.tsx`, `ThreadHistoryLoader.tsx`, `backend/`, theme (`PESDacMockupTheme.ts`), global CSS, auth flow, turn-level send/stream/edit/regenerate logic beyond the composer `status` merge |

Rationale for a single stream: the signal (session.ts), both consumers (Pesdac welcome + ThreadView), and the loader-suppression fix all meet in one `status` merge and one skeleton predicate. Splitting would manufacture merge conflicts in `ThreadView.tsx` and `Pesdac.tsx` for no parallelism gain. Small effort, one session.

## Build order (inside the stream)

1. `session.ts`: add render-direct sync-error signal (same pattern as `getChatMessagesStatus`/`getChatHydratePending`, e.g. `getChatSyncError(key) → string | null` + `getChatHydrateFailed()`), set at each `notifyFailure` site for hydrate/history/persist/create, cleared on success. Unblock hydrate retry: `kept-memory` must release/stale-check the `chatHydratedRef`-equivalent gate so a Retry can re-fire. Pure predicates stay unit-testable; no toast-copy changes.
2. `Pesdac.tsx`: derive `hydrateFailed`; change `isHistoryLoading` to `provisionalThread != null && !hydrateFailed`; add welcome-composer error branch per spec §4 precedence (`syncError` above storage/corrupt, `statusPosition="top"` only for errors). Toast bridge untouched.
3. `ThreadView.tsx`: merge sync error into the existing `status={}` chain at `:1694` (precedence `sendError > syncError > storage/corrupt`; `statusPosition="top"` when the winning status is an error); suppress `ThreadHistoryLoader` when `historyStatus === "failed"` or sync error present (memory paint shows); add history Retry that re-calls `loadChatMessages(sessionKey, chatAuth, { notify })`. No changes to turn rendering, streaming, edit, vote, find, artifact, or drawer logic.
4. Tests: extend skeleton predicate tests (`failed` ⇒ no skeleton) + provisional-hydrate-failed case (spinner off + error set); one test per new signal (set on failure, cleared on success, 401 stays silent). Then gates.

## My merge procedure (lead reviewer = me)

1. Cut `feat/chat-error-display` from current `main`.
2. Land the stream; re-run full gates on the merge: frontend `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`, `git diff --check` from repo root.
3. User-assisted browser matrix (backend stopped vs running):
   - B1: deep link with backend down → one toast, spinner stops, thread composer top error, Retry re-attempts.
   - B2: `/new` with backend down → one toast, welcome composer top error, typed text preserved.
   - B3: send with backend down → one toast, composer error, no duplicate user message on retry.
   - B4: regressions — rate-limit warning, storage/corrupt warnings, guest + demo (zero fetches), 401 → global re-login only.

## File touch budget

- Max six touched source files (expected: three edits + one-two test files). Exceeding it means the stream was mis-scoped — split and report.

## Risks

- Predicate "cleanup" (restating `shouldShowThreadSkeleton`/`shouldShowChatListSkeleton` semantics while touching the branch): forbidden — wire the failed-suppression per spec, keep predicates pure and tested.
- Copy improvisation (new error strings): forbidden — reuse the existing toast strings verbatim as the single source.
- Toast-position/type changes or sidebar error chrome: forbidden — toast stays as-is; sidebar actions stay toast-only per spec §3.
- Retry-storm (auto-retry loops on failure): forbidden — Retry is user-initiated only; no timers, no effect-loop refetch.
- A concurrent run editing `Pesdac.tsx`/`ThreadView.tsx`: the prompt carries the courtesy rule — `git status --short` first, touch only the spec-owned lines, report collisions instead of overwriting.
