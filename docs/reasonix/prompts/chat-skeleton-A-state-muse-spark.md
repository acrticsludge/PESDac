# Muse Spark implementation prompt: Stream A — skeleton state + predicates (parallel-safe)

You are Muse Spark implementing in the PESDac repository. Work on medium reasoning. Read these first, in order:

- `AGENTS.md`
- `docs/reasonix/specs/chat-skeleton-loading.md` (§6 FR1 is your build order)
- `docs/reasonix/plans/chat-skeleton-loading-plan.md` (your stream row + merge order)

Key source files (open before editing):

- `frontend/src/lib/session.ts:516-563` (seed-pending pattern + `shouldShowIdentitySkeleton` to mirror), `:662-680` (`chatHydratedKey` + `getChatMessagesStatus`), `:1077-1111` (`hydrateChats` entry/exit points), `:1113-1122` (`__resetChatBackingForTesting`)
- `frontend/tests/auth-session-flow.test.ts:198-218` (predicate test style to mirror; node:test + assert/strict, no DOM lib)

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

Add the skeleton state layer: a hydrate-pending flag plus the two frozen predicates. No component edits. Verify `chat-sync.ts` exists on your base (it should — you only import its callers' statuses, never edit it; if anything about the contract looks wrong, report file:line instead of renegotiating).

## Hard constraints

- Touch ONLY: `frontend/src/lib/session.ts` (append-only — new state + getters/setters + predicates + reset extension; no renames, no behavior change to existing exports) and `frontend/tests/chat-skeleton-predicates.test.ts` (new).
- NEVER edit `Pesdac.tsx`, `ThreadView.tsx`, `chat-sync.ts`, anything under `backend/`, theme, or CSS.
- Exact frozen signatures: `getChatHydratePending(): boolean`, `setChatHydratePending(b: boolean): void` (emit on set), `shouldShowChatListSkeleton(authStatus: string, hydratePending: boolean, customCount: number): boolean` (true iff authenticated && hydratePending && customCount === 0), `shouldShowThreadSkeleton(isBacked: boolean, msgStatus, overlayLen: number, explicitFlag?: boolean): boolean` (true iff explicitFlag === true || (isBacked && loading && overlayLen === 0)).
- `setChatHydratePending(true)` at `hydrateChats` entry (after guest/already early-returns), `false` on EVERY exit (ready + kept-memory + catch), identity-guarded so a stale resolve cannot clear a newer identity's bit (mirror the epoch-guard philosophy in `Pesdac.tsx:560`).
- Work on branch `feat/chat-skeleton-state` (create once with `git checkout -b`). Never touch main. Do not commit, push, or reset files. Max five touched files.
- Synthetic fixtures only; no PII.

## Required working method

Work in order: (1) flag + wiring, (2) predicates, (3) reset + tests, (4) gates. Report after each with:

```text
Task: A_
Evidence observed:
Files inspected:
Files changed:
Acceptance criteria completed:
Commands/tests run:
Failures or warnings:
Next action:
```

If blocked, report the exact blocker and smallest safe options.

## Guardrails

- Mirror `setProfileSeedPending`/`getProfileSeedPending` shape exactly (module `let`, getter, setter with `emit()`).
- Predicate tests: hydrate flag set/cleared on success AND failure paths (stub `apiListChats` via the existing test seam — inspect `chat-backing.test.ts` before inventing); truth tables for both predicates; row-clamp helper if you add one (0→1, 9→3). Existing suites pass unmodified.
- No real timers, no network, no DOM library.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`. From repo root: `git diff --check`, `git status --short`. Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Flag + predicates match the frozen signatures byte-for-byte.
- New tests green; `auth-session-flow.test.ts` + `chat-backing.test.ts` green unmodified.
- `astro check` + `git diff --check` pass; `session.ts` diff is append-only.
- Final report: files changed + why, test results, any contract-defect reports.
