# Muse Spark implementation prompt: caching Phase 5 — adopt idempotency + 429 handling (single stream)

You are Muse Spark 1.3, running on medium reasoning, implementing in the
PESDac repository. Read these first, in order:

- `AGENTS.md` (smallest diff; backend changes confined to the adopt/create
  path + rate-limit consumption — no policy changes)
- `docs/reasonix/specs/caching-audit.md` (§4 P1-2/P1-10 + §5 Fix 5 + §10.2
  locked contract; FROZEN — defects become reports, never unilateral spec
  edits)
- `docs/reasonix/plans/caching-plan.md` (Phase 5 is your ONLY scope; Phases
  1–4 assumed merged — verify before starting; if absent, stop and report)

Key source files (open before editing):

- `frontend/src/lib/session.ts:1181-1216` (`adoptGuestChats` — partial-write
  duplication noted `:1184-1188`; send `clientAdoptKey` per guest chat),
  `:875-899` (`createChatBacked`)
- `frontend/src/lib/chat-sync.ts:60-83` (create wrapper — extend signature
  for the key; envelope shapes frozen)
- `backend/app/routers/chats.py:156-` (create endpoint — store key, per-user
  unique constraint, conflict → `200` with existing row),
  `backend/app/schemas/chats.py` (request schema — add optional key field),
  `:162,226,242,313` (429 emitters — read-only context, policy untouched)
- `frontend/src/lib/auth.ts:1199-1215` (`apiFetch` error path — consume
  `Retry-After` for chat writes: ONE bounded retry honoring
  `min(server-wait, 5s)`, same cap as the onboarding policy)
- `backend/app/routers/chats.py:78-103` (unwired purge worker — REPORT a
  recommendation only: wire vs remove. No scheduler infra in this stream)

Before touching code, run `git status --short`. Existing modified/untracked
files belong to the user or another run. Do not reset, clean, checkout,
overwrite, or commit them. Work on branch `feat/adopt-idempotency`
(create once with `git checkout -b`). Never touch main. Do not commit,
push, or reset files.

## Mission

Adopt retries duplicate chats (no idempotency) and chat-path 429s die with
one generic toast (`Retry-After` never read). Implement the locked
`clientAdoptKey` contract end-to-end and add one bounded 429 retry for chat
writes.

## Hard constraints

- Touch ONLY: adopt sender + create signature (frontend), create endpoint +
  request schema (backend), `apiFetch` 429-consumption for chat writes,
  plus tests (frontend `cache-adopt-idempotency.test.ts`; backend tests per
  the repo's existing backend test convention — discover `pyproject`/pytest
  layout first, imitate neighboring tests). NEVER edit rate-limit policy or
  values, unrelated routes, envelope shapes, toast copy, theme, Phase-1–4
  semantics.
- Contract (spec §10.2, exact): client generates one UUID per guest chat
  (`clientAdoptKey`, `crypto.randomUUID()`), sent in `POST /chats` body;
  server stores it with a per-user unique constraint; on conflict returns
  `200` with the existing row (no duplicate). Migration for the new column
  included if the repo uses migrations — discover, don't invent.
- 429: chat writes ONLY — one retry honoring `min(Retry-After, 5s)`; all
  other paths unchanged; no retry loops, no global fetch retry.
- TDD mandatory both sides: RED (retry-after-failure creates exactly one
  row; 429 honored once) → fails → minimal GREEN. NEVER weaken existing
  tests, frontend or backend.
- Purge worker: recommendation report only — no scheduler wiring.
  `git diff --check` clean.

## Required working method

Work in order: (1) backend contract + tests, (2) frontend sender + tests,
(3) 429 consumption + tests, (4) purge recommendation, (5) gates. Report
after each with:

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

- One thing per step; both suites green between steps (frontend AND backend
  commands — discover the backend test command first, never assume).
- Conflict-200 must return the row in the exact existing shape — no caller
  changes beyond reading it.
- No scope expansion into retention scheduling, rate-limit tuning, or
  cursor pagination — note instead of implementing.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`,
`npm.cmd run build`. Backend: discover (`pyproject.toml`, existing test
files/CI) then use the repo's own pytest command for the chats router
scope + full backend suite before finishing. From repo root:
`git diff --check`, `git status --short`. Paste exact failures; never weaken
tests to pass.

## Acceptance checklist

- Adopt with 2nd-leg failure → retry → exactly one server row (backend test
  + frontend stubbed test agree).
- Duplicate `clientAdoptKey` POST → `200` existing row, zero new rows.
- Chat-write 429 with `Retry-After: 2` → one retry after ~2 s, then success
  surfaces normally; no retry on non-chat paths.
- Purge-worker recommendation reported with smallest safe option.
- Both suites green; diff confined to owned files.
- Final report: files changed + why, test results.
