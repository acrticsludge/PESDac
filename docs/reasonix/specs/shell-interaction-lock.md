# Spec: shell interaction lock while user data is loading

Status: Proposed
Audit basis: code inspection only (no code changed for this spec) — `frontend/src/lib/auth.ts:317` (`useAuth`), `:825` (`useProfile`), `frontend/src/lib/session.ts:520` (seed pending), `:676` (message status), `:1077` (hydrate), `frontend/src/components/Pesdac.tsx:936-1164` (sidebar + welcome send paths), `:1178-1219` (shortcuts), `:1444-1758` (search + composers), `frontend/src/components/chat/ThreadView.tsx:1070` (`handleSend`), `:1684-1828` (thread composer + actions), `frontend/src/components/profile/sections.tsx:387-414` (`isDisabled` pattern), `frontend/src/components/auth/AuthGate.tsx` + `OnboardingDialog.tsx` (required-purpose, untouched).
Stack: Astro + React 19 + Astryx 0.5.2 + StyleX + `PESDacMockupTheme` (per `AGENTS.md`; `CLAUDE.md` Next.js/Supabase references are stale for this repo and do not apply).

## 1. Problem

While the skeleton work (see `docs/reasonix/specs/chat-skeleton-loading.md`) makes fetches VISIBLE, every control behind the skeletons stays LIVE: the welcome composer accepts sends, sidebar rows navigate, pin/rename/archive/delete menus fire, the thread composer sends/edits/retries, and Ctrl+K / `/` shortcuts act — all while the identity, profile seed, or chat list they operate on is still resolving. A send or navigation mid-hydrate can create against a stale identity, double-list after adopt-then-replace, or silently drop user text.

## 2. Users

- Signed-in users on slow loads (refresh, cold backend, throttled network): inputs must be visibly inert until the shell knows who they are and which chats exist.
- Guests: must stay fully interactive (guest is a READY state, not loading).
- Users on failed loads: must stay interactive (error → retry/toast paths, never a dead shell).

## 3. Goals

1. Define ONE loading predicate for the whole shell: auth loading OR profile loading OR seed pending OR hydrate pending.
2. While it is true: all mutating shell interactions are inert (sends, navigations, sidebar ops, menus, search, shortcuts, attach/reference/mode controls). The lock and the skeletons coincide.
3. The lock is communicated accessibly (`isDisabled` on supporting Astryx controls + `aria-busy`/`aria-disabled` on shell containers) with zero layout change.
4. Required-purpose surfaces (`AuthGate`, `OnboardingDialog`) and failure surfacing (toasts, retry buttons) keep working exactly as today.

## 4. Non-goals

- No overlay modal, no backdrop, no spinner swap, no theme/CSS change. Locking is per-control disabling + handler guards, not a new visual layer.
- No change to the locked-vs-unlocked CONTENT (skeletons own the visuals; this spec owns inertness).
- No auto-retry, no mutation-queue-while-locked (locked sends are ignored, not queued — queuing across identities is the exact bleed this spec prevents).
- No change to in-thread streaming stop (`isStopShown`/stop stays live once a stream the user started is running — stopping your own stream is not a mutation against unresolved data).
- No backend, schema, migration, endpoint, or dependency change.

## 5. User flows

### F1: Authed refresh, slow hydrate (locked → unlocked)

1. Refresh `/new` signed in: shell paints skeletons AND every composer/row/menu/shortcut is inert (send does nothing, rows do not navigate, Ctrl+K and `/` do nothing).
2. Hydrate + seed resolve → controls enable in place, no stuck disabled, no lost focus beyond the normal resolve.

### F2: Thread switch while history loads (composer locked, thread skeleton shows)

1. Open a server-backed chat with empty overlay: thread composer + edit/retry/vote/attach/find/mode are inert; scroll, skeleton paint, and existing toasts stay live.
2. History resolves → thread controls enable.

### F3: Guest (never locked)

Guest refresh: everything interactive, zero fetches, byte-identical to today.

### F4: Failure (never stuck locked)

Forced hydrate/history/profile failure: lock releases with the memory paint + the existing single toast each; retry affordances (where they exist today) work.

## 6. Functional requirements

### FR1: Predicate (append-only in `session.ts`)

- `shouldBlockShellInteractions(authStatus: string, profileStatus: string, seedPending: boolean, hydratePending: boolean): boolean` → true iff ANY input is loading/pending (`authStatus === "loading" || profileStatus === "loading" || seedPending || hydratePending`). Guest/error/ready-empty → false. Pure, unit-testable, mirroring `shouldShowIdentitySkeleton` doctrine. Extend test resets if new module state is added (none expected — the predicate reads the four existing signals, including `getChatHydratePending()` from the skeleton stream when present).

### FR2: `Pesdac.tsx` wiring

- Compute `isShellLocked` once per render from the four signals (reactive through the existing `useSessionVersion()`; no new subscription mechanism).
- When true, early-return (no-op) in: `handleWelcomeSend`, `openConversation`, `startNewChat`, `openRef`, `archiveAndExit`, menu `wrap`/`wrapAsync` bodies, `applySuggestion`, `stageIntoDrawer`. Rename/delete confirm paths keep their dialog-local busy states and additionally no-op while locked.
- Set `isDisabled` on supporting Astryx controls (New chat / Search / conversation `SideNavItem`s / search `TextInput` / composer action `Button`s / `DropdownMenu` buttons / `MoreMenu` triggers where the prop exists — mirror the `isSavingName`/`isLoggingOut` pattern, never a custom disabled style).
- Add `aria-busy="true"` + `aria-disabled="true"` on the sidebar list and main-chat containers while locked.
- Shortcuts: suppress Ctrl/⌘+K and `/`-focus while locked; Esc + `isGateOpen`/`isOnboardingOpen` yield stays exactly as today (`Pesdac.tsx:1193`).

### FR3: `ThreadView.tsx` prop

- New optional `isInteractionLocked?: boolean` (default `false` — zero behavior change until a caller passes true, same pattern as `isHistoryLoading`). When true: guard `handleSend`/retry/edit/attach/find/mode/vote paths (no-op) and disable action buttons; scroll, skeleton, copy-transcript READ stays live; stop-stream stays live. `Pesdac.tsx` passes `isShellLocked` (OR-ed with nothing — history-loading lock arrives via the same boolean from the caller).

### FR4: No other behavior change

Gate/onboarding open conditions, Esc handling, toast copy/routes, search filtering (when unlocked), and `ConversationItem` Spinner paths are untouched.

## 7. Acceptance criteria

- [ ] AC1: Authed throttled-hydrate refresh: sends/navigations/menus/shortcuts all inert until resolve; then enable with no stuck disabled.
- [ ] AC2: Thread open with empty overlay + loading history: thread composer + edit/retry/vote/attach/find/mode inert; scroll + toasts live; enable on resolve.
- [ ] AC3: Guest refresh fully interactive with zero chat fetches; failed loads release the lock with memory paint + existing toasts.
- [ ] AC4: Keyboard-only: focus never lands on a disabled control while locked; `aria-busy`/`aria-disabled` present; Esc still yields to gate/onboarding.
- [ ] AC5: `npm.cmd test` + `astro check` + `astro build` + `git diff --check` pass; new predicate tests (node:test, no DOM lib).
- [ ] AC6: Astryx UI/theme/copy/layout unchanged; desktop + <=640px; clean console.

## 8. Constraints

- `AGENTS.md` UI rules apply in full. Max five touched source files (expected: `session.ts`, `Pesdac.tsx`, `ThreadView.tsx`, one test file).
- Work on `fix/shell-interaction-lock` from main; no commit/push unless asked.
- Synthetic fixtures only; no PII. Never log user text in lock paths.

## 9. API / interface requirements

- `shouldBlockShellInteractions(authStatus: string, profileStatus: string, seedPending: boolean, hydratePending: boolean): boolean` (pure).
- `ThreadView` gains `isInteractionLocked?: boolean` (default false). No other public signature changes; no route/envelope changes.

## 10. Data requirements

- None. No schema/migration. Lock state derives from existing transient signals.

## 11. Security requirements

- Locked sends are dropped, never queued (no cross-identity bleed). No new fetch, no new auth code path; 401s keep flowing to the existing global handler. No tokens/PII in tests or logs.

## 12. Testing requirements

- Unit (node:test): predicate truth table (each single signal locks; all-clear unlocks; guest/error/ready-empty never lock; thread explicit-flag equivalence noted).
- Existing `auth-session-flow.test.ts` + `chat-backing.test.ts` + skeleton predicate suites pass unmodified.
- Browser (user-assisted): F1/F2/F3/F4 on desktop + narrow with throttled hydrate/history; keyboard pass; clean console.

## 13. Rollout / rollback

- Rollout: frontend-only, single branch. No flag/env/migration. Lands after or with the skeleton streams (lock without skeletons would read as a dead shell — merge alongside Stream A at minimum).
- Rollback: revert branch; controls return to today's always-live behavior. No data impact.
