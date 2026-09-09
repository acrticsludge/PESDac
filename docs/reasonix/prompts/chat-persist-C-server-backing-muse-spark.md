# Muse Spark implementation prompt: Stream C — server backing + UI wiring (WAVE 2)

You are Muse Spark implementing in the PESDac repository. Work on medium
reasoning. Read these first, in order:

- `AGENTS.md` (Astryx/UI rules in full — this stream touches components)
- `docs/reasonix/specs/chat-persistence-sync.md` (§5 is your build order)
- `docs/reasonix/plans/chat-persistence-plan.md` (your stream row + why you
  are wave 2)
- `docs/slices/slice-12-loading-and-optimistic-ui.md` (optimistic contract §84-96)

Key source files (open before editing):

- `frontend/src/lib/chat-sync.ts` (stream B's module — already merged to your
  base; import it, NEVER edit it)
- `frontend/src/lib/session.ts:1-60,141-221,538-542` (store shape, chat fns,
  `clearAllChats`; memory-cache + `emit()` reactivity to preserve)
- `frontend/src/lib/auth.ts` (epoch, `TaggedCache` philosophy, `toUserMessage`)
- Call sites you may touch (ONLY these): `frontend/src/components/Pesdac.tsx`
  (sidebar ops + hydrate effect home), `frontend/src/components/chat/ThreadView.tsx`
  (message load/send/edit/regenerate). Anything else → stop and report.

Before touching code, run `git status --short`. Existing modified/untracked
files belong to the user or another run. Do not reset, clean, checkout,
overwrite, or commit them.

## Mission

Implement §5: server write-through backing for the memory store. Guests stay
memory-only (today's behavior, untouched code path). Wave-2 start is
intentional — you need stream B merged; verify `chat-sync.ts` exists on your
base before writing a line (`git log --oneline -3` must show its merge; if
not, stop and report instead of stubbing around it).

## Hard constraints

- Touch ONLY: `frontend/src/lib/session.ts`, the two call-site components
  above, `frontend/tests/chat-backing.test.ts` (new), and existing frontend
  tests ONLY by append (never rewrite assertions — same rule as the
  initial-session suite).
- NEVER edit `frontend/src/lib/chat-sync.ts` or anything under `backend/`.
  Contract (§3/§4) is FROZEN — defects become file:line reports, not edits.
- Reads stay synchronous from memory; mutations go async with snapshot
  rollback + toast (slice-12 contract — no silent divergence, `finally`
  clears pending).
- Guest path byte-identical: no fetches, no tags consulted, memory as today.
  `unknown`-tag windows never hydrate (fail closed to current behavior).
- No new dependencies. No DOM library: stub fetch + document as existing
  harnesses do. Synthetic fixtures only.
- Work on branch `feat/chat-server-backing` (create once with `git checkout -b`
  from a main containing stream B). Never touch main. Do not commit, push, or
  reset files. Max five touched source files — split and report if exceeded.

## Required working method

Work in order: (1) session backing + hydrate + adopt, (2) turn load/send/
edit/regenerate wiring, (3) pin/archive migration + call-site updates, (4)
gates. Report after each with:

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

- Hydrate triggers on authenticated-identity-K only (epoch-gated; reuse the
  `TaggedCache`/epoch philosophy — no parallel identity scheme). Server list
  REPLACES memory customs; a failed hydrate keeps memory paint + one toast.
- Adopt is per-chat all-or-nothing (container + all overlay blocks in order,
  or skip the chat); failures keep memory for next login; success drops the
  adopted chats from memory. Never duplicate (adopted-then-hydrated must not
  double-list — order ops: adopt FIRST, then hydrate-replace).
- Pin/archive migration: one PATCH per memory-flagged chat present server-side,
  once; then key-sets retire (delete them) and flags rule. Document the
  retirement in a code comment at the deletion site.
- Turns: open-chat loads once (skeleton while loading); send persists user
  block then assistant-at-completion (stop persists partial — preserve today's
  semantics); edit = truncate-from-index + resend; regenerate = delete-last +
  rerun. Memory order is append-order; never synthesize `seq` client-side.
- 401 anywhere → existing global flow; no extra error UI.
- Tests: hydrate-replaces, failed-hydrate-keeps-memory, adopt-once/adopt-retry,
  rollback-on-forced-failure per mutation, guest-untouched, pin/archive
  migration. Existing suites pass unmodified.

## Commands

From `frontend/`: `npm.cmd test`, `npm.cmd run astro -- check`,
`npm.cmd run build`. From repo root: `git diff --check`, `git status --short`.
Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- §5 fully implemented; guest path provably untouched (tests + reasoning).
- Full gates green; backend untouched (prove via `git status --short`).
- Astryx UI/copy/layout unchanged; desktop + narrow; clean console.
- Browser matrix is the LEAD's job at merge — but list the routes/clicks you
  used for any manual checks you did.
- Final report: files changed + why, test results, any contract-defect reports.
