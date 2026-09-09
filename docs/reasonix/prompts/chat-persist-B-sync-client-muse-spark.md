# Muse Spark implementation prompt: Stream B — sync client (frontend, new files only)

You are Muse Spark implementing in the PESDac repository. Work on medium
reasoning. Read these first, in order:

- `AGENTS.md`
- `docs/reasonix/specs/chat-persistence-sync.md` (§4 is your build order)
- `docs/reasonix/plans/chat-persistence-plan.md` (your stream row)

Key source files (READ-ONLY — do not edit; open to match conventions):

- `frontend/src/lib/auth.ts` (`apiFetch`, `ApiError`, envelope shapes ~lines 88-104, 1147-1216)
- `frontend/tests/initial-session.test.ts` (node:test + stub style to copy)

Before touching code, run `git status --short`. Existing modified/untracked
files belong to the user or another run. Do not reset, clean, checkout,
overwrite, or commit them.

## Mission

Create `frontend/src/lib/chat-sync.ts` + `frontend/tests/chat-sync.test.ts`
implementing §4 exactly. This stream creates NEW files and edits NOTHING
existing — that is what makes it parallel-safe with streams A and C.

## Hard constraints

- You may create EXACTLY two files: `frontend/src/lib/chat-sync.ts`,
  `frontend/tests/chat-sync.test.ts`. Editing ANY existing file — even a
  one-line import fix elsewhere — means stop and report. (If §4 turns out to
  need an existing-file change, that change belongs to stream C; file it as a
  precise request: file, lines, exact diff wanted.)
- Contract is FROZEN: the 8 function signatures, `ServerChat`/`ServerMessage`
  shapes, error propagation as `ApiError` (NO toasts, NO `toUserMessage` in
  this module — surfacing is stream C's job).
- No new dependencies. No DOM library in tests: stub global `fetch` (and
  `import.meta.env` via the existing test hooks if needed); assert request
  paths/methods/bodies + mapped return values + error propagation.
- `apiFetch` already prefixes `/api/v1` — pass bare paths (`/chats`, NOT
  `/api/v1/chats`).
- Work on branch `feat/chat-sync-client` (create once from main with
  `git checkout -b`). Never touch main. Do not commit, push, or reset files.
- Synthetic fixtures only.

## Required working method

Report after (module / tests / gates) with:

```text
Task: B_
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

- Thin wrappers only: path join, method, body, response mapping
  (`createdAt`/`updatedAt` passthrough, `deleted` counts). No caching, no
  identity logic, no retry — the module is deliberately dumb; doctrine lives
  in stream C.
- `apiDeleteChat` resolves `void` on 204 (empty body — do not `res.json()` a
  204; mirror how the codebase handles `apiFetch<void>`).
- `apiListMessages` returns the `data` array (pagination passthrough unnecessary
  at this layer — but do NOT discard it silently if the type promises it;
  return `data` and type the return as the array, per §4).
- Tests: one test per function (success mapping) + error propagation (401 →
  `AuthRequiredError`, 404 → `ApiError` with body, network failure →
  `TypeError` passthrough) + a 204-no-body case. No real timers, no network.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`. From repo
root: `git diff --check`, `git status --short` (must show ONLY your two new
files). Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Both files exist, §4 signatures exact, zero edits to existing files (prove
  via `git status --short`).
- Tests green; `astro check` 0 new errors; diff-check clean; zero backend diffs.
- Final report: any §4-defect reports or stream-C change requests (file:line +
  exact wanted diff, no implementation outside your two files).
