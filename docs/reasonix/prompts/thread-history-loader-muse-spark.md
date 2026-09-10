# Muse Spark implementation prompt: thread history loader — running chip replaces skeleton (single stream)

You are Muse Spark implementing in the PESDac repository. Work on medium reasoning. Read these first, in order:

- `AGENTS.md` (Astryx/UI rules in full — this stream touches components)
- `docs/reasonix/specs/thread-history-loader.md` (§6 FR1–FR4 is your build order)
- `docs/reasonix/plans/thread-history-loader-plan.md` (your owned files + why you never edit `session.ts`)

Key source files (open before editing):

- `frontend/src/components/chat/ThreadSkeleton.tsx` (read-only reference for the wrapper + assistant shell you carry over; then DELETE it)
- `frontend/src/components/chat/ThreadLoaderMockups.tsx` (`OptionBToolcallChip` — your locked chip props, verbatim; plus the baseline section you will remove per FR3)
- `frontend/src/components/chat/ThreadView.tsx:71` (import line — your ONLY import edit), `:790-793` (`showHistorySkeleton` — read-only, frozen), `:1840-1843` (JSX tag — your ONLY render edit)
- `frontend/node_modules/@astryxdesign/core/src/Chat/ChatToolCalls.tsx:46-91` (item shape), `:419-453` (running renders `Spinner sm` + name + target inline — no collapsible for a single call)
- `frontend/src/lib/session.ts:612-625` (predicates — FROZEN, never opened for editing)

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them. Untracked `/mockups` files from the exploration (`mockups.astro`, `ThreadLoaderMockups.tsx`) are expected — read them, edit only what FR3 allows.

## Mission

`/mockups` Option B won: replace the 3-turn skeleton bars with one honest running chip. The thread claims no structure while loading, animates from frame one, and announces via `role="status"`. Guests and ready-empty never load.

## Hard constraints

- Touch ONLY: `frontend/src/components/chat/ThreadHistoryLoader.tsx` (new), `frontend/src/components/chat/ThreadSkeleton.tsx` (delete), `frontend/src/components/chat/ThreadView.tsx` (import line + one JSX tag), `frontend/src/components/chat/ThreadLoaderMockups.tsx` (baseline removal + Option B copy).
- NEVER edit `session.ts` (predicates frozen; if anything about the loading window looks wrong, report file:line), `chat-sync.ts`, `lib/chat.ts`, `Pesdac.tsx`, `backend/`, theme, or CSS. NEVER touch send/stream/edit/regenerate/vote logic, search filtering, shortcuts, or any test file (existing suites must pass unmodified).
- `ThreadHistoryLoader()` — no props, presentational only: wrapper `VStack gap={4}` with `aria-busy="true"` + `aria-label="Loading chat history"`; single `ChatMessage sender="assistant"` + `Avatar name="PESDac" size="md"`; single `ChatMessageBubble variant="ghost"` containing `ChatToolCalls calls={[{ name: "history", target: "Chat history", status: "running" }]}` — props verbatim from the approved mockup, no improvisation. No user turn, no metadata bars, no follow-ups, no artifact panel, no `isStreaming`. Imports: `Theme` NOT needed (page/thread shell owns it); `VStack` from `@astryxdesign/core/Layout`, `Skeleton` NOT imported (no bars remain).
- `ThreadView.tsx`: swap the import and the single JSX tag inside the existing `showHistorySkeleton` ternary — the condition stays byte-identical. Nothing else in the file.
- `ThreadLoaderMockups.tsx`: delete the `ThreadSkeleton` import + "Baseline" section; update Option B `body` to note it shipped. Nothing else on the page.
- Work on branch `feat/thread-history-loader` (create once with `git checkout -b`). Never touch main. Do not commit, push, or reset files. Max five touched files.

## Required working method

Work in order: (1) new component, (2) delete + ThreadView swap, (3) mockups cleanup, (4) gates. Report after each with:

```text
Task: FR_
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

- Pending-vs-empty stays distinct: ready-with-zero renders the real empty list. Failure keeps memory paint + existing toast; chip just unmounts.
- No layout ambition: the row is compact by design — the list only grows on resolve. No height-faking, no overlay, no modal, no Spinner swap elsewhere.
- No `typeof window`, no random values in the new component (hydration safety).
- Final `grep ThreadSkeleton frontend/src` must be clean (docs/history excluded).

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`. From repo root: `git diff --check`, `git status --short`, `grep ThreadSkeleton frontend/src` (via your search tool). Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Throttled history load (incl. deep-link pending + `!isAppReady` gate): running chip from frame one → real turns, list only grows, composer live (browser if feasible).
- Guest + demo + ready-empty: zero loaders, zero fetches.
- SR/reduced-motion: status announced, no frozen bars.
- Full gates green; `grep` clean; diff confined to owned files.
- Final report: files changed + why, test/browser results.
