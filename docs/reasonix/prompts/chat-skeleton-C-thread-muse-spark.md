# Muse Spark implementation prompt: Stream C — thread history skeleton ditto/dynamic upgrade (parallel-safe)

You are Muse Spark implementing in the PESDac repository. Work on medium reasoning. Read these first, in order:

- `AGENTS.md` (Astryx/UI rules in full — this stream touches components)
- `docs/reasonix/specs/chat-skeleton-loading.md` (§6 FR3 is your build order)
- `docs/reasonix/plans/chat-skeleton-loading-plan.md` (your stream row + why you never edit `session.ts` or `Pesdac.tsx`)

Key source files (open before editing):

- `frontend/src/components/chat/ThreadView.tsx:449-468` (`SkeletonThread` — becomes a thin wrapper), `:799-811` (`historyStatus`/`showHistorySkeleton` + load trigger), `:1429-1560` (REAL shells: `renderUserBlock`/`renderAssistantBlock` — your ditto source), `:1684-1828` (composer stays live — do NOT touch), `:1832-1908` (`ChatMessageList` block — your ONLY render edit)
- `frontend/src/components/profile/SkeletonBlock.tsx:62-103` (ditto doctrine reference)
- `frontend/src/lib/session.ts:676-680` (`getChatMessagesStatus` — import, never edit)

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them.

## Mission

Replace the fixed 2-bubble placeholder with a structure-mirroring 3-turn template (user / assistant / assistant) inside the real message shells. Memory paint still wins whenever the overlay is non-empty; the composer stays live throughout.

## Hard constraints

- Touch ONLY: `frontend/src/components/chat/ThreadSkeleton.tsx` (new) and `frontend/src/components/chat/ThreadView.tsx` (SkeletonThread + showHistorySkeleton + ChatMessageList block only).
- NEVER edit `session.ts` (import `shouldShowThreadSkeleton` if present on your base; else keep the existing `showHistorySkeleton` expression on its current lines and note it for the rebase), `Pesdac.tsx`, `chat-sync.ts`, backend, theme, or CSS. NEVER touch send/stream/edit/regenerate/vote logic.
- `ThreadSkeleton()`: (a) user turn: `ChatMessage sender="user"` + `ChatMessageBubble` with `Skeleton 180x12` + `120x12`; (b,c) two assistant turns: `ChatMessage sender="assistant"` + `Avatar name="PESDac" size="md"` + `ChatMessageBubble variant="ghost"` with `280x12 + 200x12`, then `220x12` + metadata line `Skeleton 96x10`. Toolcall-shape row (`160x32 r2`) ONLY when the loading chat provably had toolcalls — never invented. Same `VStack` gaps as real turns. `aria-busy="true"`, `aria-label="Loading chat history"`. No `isStreaming`, no follow-ups, no artifact panel, no divider.
- Keep `overlay.length === 0` memory-wins rule and the `isHistoryLoading` explicit-flag OR exactly as today. Failure → memory paint + existing single toast; skeleton unmounts.
- Work on branch `feat/chat-skeleton-thread` (create once with `git checkout -b`). Never touch main. Do not commit, push, or reset files. Max five touched files.

## Required working method

Work in order: (1) new component, (2) wrapper + condition + render swap, (3) gates. Report after each with:

```text
Task: C_
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

- Demo threads (static, no fetch) must never show the template — verify the `isBacked` gate still excludes them.
- No new test file (no component harness in this repo); predicate coverage lives in Stream A. If you extract a pure helper (e.g. template-shape picker), unit-test it in place — otherwise say so and rely on `astro check` + build + browser proof.
- A spinner/overlay/modal "improvement" is forbidden — ditto-inside-real-shells only.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`. From repo root: `git diff --check`, `git status --short`. Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Open/switch with empty overlay: template → real turns, composer live (browser, throttled `apiListMessages` if feasible).
- Non-empty overlay, guests, demos: zero skeletons.
- Full gates green; `ThreadView.tsx` diff confined to the owned ranges.
- Final report: files changed + why, condition-line location (if pre-A fallback kept) for the rebase, browser results.
