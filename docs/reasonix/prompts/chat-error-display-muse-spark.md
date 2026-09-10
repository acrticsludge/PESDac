# Muse Spark implementation prompt: chat error display — toast + composer status (single stream)

You are Muse Spark 1.3, running on medium reasoning, implementing in the PESDac repository. Read these first, in order:

- `AGENTS.md` (Astryx/UI rules in full — this stream touches composers; no redesign, no theme/CSS changes, smallest diff)
- `docs/reasonix/specs/chat-error-display.md` (§4 UX contract + §5 change table is your build order; FROZEN — defects become reports, never unilateral spec edits)
- `docs/reasonix/plans/chat-error-display-plan.md` (your owned files + branch + why you never touch `chat-sync.ts`/theme/backend)

Key source files (open before editing):

- `frontend/src/lib/session.ts:617-625` (skeleton predicates — keep pure), `:721-728` (`notifyFailure`, 401-silence stays), `:1054-1089` (`loadChatMessages` failed path), `:1206-1244` (`hydrateChats` kept-memory path)
- `frontend/src/components/Pesdac.tsx:600-612` (toast bridge + hydrate gate), `:1874-1904` (provisional deep-link + `isHistoryLoading` + thread props), `:1940-1961` (welcome composer `status` chain — your error branch goes here)
- `frontend/src/components/chat/ThreadView.tsx:786-802` (history status + skeleton condition), `:1694-1710` (thread composer `status` chain — your merge goes here), `:1840-1843` (`ThreadHistoryLoader` branch — your suppression goes here)
- `frontend/src/components/chat/ThreadHistoryLoader.tsx` (read-only — presentational, never edited)
- `frontend/src/components/AppToasts.tsx` (read-only — toast host, never edited)
- `frontend/node_modules/@astryxdesign/core/src/Chat/` (verify `ChatComposer` `status` + `statusPosition="top"` prop shape before wiring; error on top, warning stays bottom)

Before touching code, run `git status --short`. Existing modified/untracked files belong to the user or another run. Do not reset, clean, checkout, overwrite, or commit them. Work on branch `feat/chat-error-display` (create once with `git checkout -b`). Never touch main. Do not commit, push, or reset files.

## Mission

Chat sync failures are toast-only today and the history loader can spin forever on a backend-down deep link. Wire every chat sync failure to the existing toast (unchanged) PLUS a persistent `ChatComposer.status` error, and make the spinner always terminate with a Retry path.

## Hard constraints

- Touch ONLY: `frontend/src/lib/session.ts` (sync-error signal + hydrate-retry gate), `frontend/src/components/Pesdac.tsx` (hydrate-failed derivation + welcome composer error branch), `frontend/src/components/chat/ThreadView.tsx` (thread composer error branch + loader suppression + history Retry), plus the plan-owned test files. NEVER edit `chat-sync.ts`, `lib/chat.ts`, `AppToasts.tsx`, `ThreadHistoryLoader.tsx`, `backend/`, theme, or global CSS.
- Composer contract (spec §4): sync/backend errors → `status={{ type: "error", message }} statusPosition="top"`; warnings (rate-limit, storage, corrupt) keep bottom position untouched. Precedence: `sendError > syncError > storage/corrupt`. Message copy reuses existing toast strings verbatim — no new copy.
- `session.ts`: signal is render-direct reactive (same pattern as `getChatMessagesStatus`), set at hydrate/history/persist/create `notifyFailure` sites, cleared on success; 401 stays silent. `kept-memory` must release/stale-check the hydrate gate so Retry can re-fire — user-initiated only, no auto-retry loops, no timers.
- `Pesdac.tsx`: `isHistoryLoading={provisionalThread != null && !hydrateFailed}`; welcome composer error branch only; toast bridge and all other logic byte-identical.
- `ThreadView.tsx`: merge into the existing `status={}` chain only; suppress the loader branch on `failed`/sync-error (memory paint shows); history Retry re-calls `loadChatMessages` with the same `{ notify }`. No turn/stream/edit/vote/find/artifact/drawer changes.
- NEVER weaken existing tests to pass; NEVER add sidebar error chrome; NEVER change toast position/type/copy.

## Required working method

Work in order: (1) session.ts signal + gate, (2) Pesdac wiring, (3) ThreadView wiring, (4) tests + gates. Report after each with:

```text
Task: step_
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

- Pending-vs-empty stays distinct: ready-with-zero renders the real empty list; failure keeps memory paint + existing toast and the loader unmounts.
- Draft preservation: failed create/send keeps the typed text (existing restore path); Retry never duplicates the user message.
- No `typeof window` additions, no random values, no layout/CSS/theme edits (hydration + design-source-of-truth safety).
- Final diff confined to owned files; `git diff --check` clean.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`. From repo root: `git diff --check`, `git status --short`. Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Backend down → deep link: one toast, spinner stops, thread composer top error, Retry re-attempts load.
- Backend down → `/new`: one toast, welcome composer top error, typed text preserved.
- Backend down → send: one toast, composer error, no duplicate user message on retry.
- Regressions: rate-limit/storage/corrupt warnings unchanged; guest + demo zero fetches; 401 → global re-login only.
- Full gates green; diff confined to owned files.
- Final report: files changed + why, test/browser results.
