# Plan: chat persistence + history sync (3 parallel streams)

Shared contract: `docs/reasonix/specs/chat-persistence-sync.md` (FROZEN — streams
build against it; defects become reports, never unilateral edits).
Status: Proposed.

## Stream file-ownership (exclusive — a stream touching another stream's files stops and reports)

| Stream | Branch | Owns (ONLY these) | Must NEVER touch |
|---|---|---|---|
| A messages API | `fix/chat-messages-api` | `backend/app/models/chats.py`, `backend/app/schemas/chats.py`, `backend/app/routers/chats.py`, `backend/alembic/versions/0006_*.py` (new), `backend/tests/test_messages_contract.py` (new) | anything under `frontend/` |
| B sync client | `feat/chat-sync-client` | `frontend/src/lib/chat-sync.ts` (new), `frontend/tests/chat-sync.test.ts` (new) | any EXISTING file, backend |
| C server backing | `feat/chat-server-backing` | `frontend/src/lib/session.ts`, `frontend/tests/chat-backing.test.ts` (new), call-site components ONLY as listed in its prompt, slice note | `chat-sync.ts`, backend |

## Dependency order

```text
A ──┐ (independent; needs only the spec)
B ──┤ (independent; needs only the spec — tests stub fetch, no live backend)
    │
    └─ C (needs B MERGED — it imports chat-sync.ts; starts after B lands.
          B is small by design so the wait is one session, not a phase.)
```

Wave 1 runs A + B in parallel, zero conflict surface (disjoint file sets,
disjoint suites, disjoint runtimes). Wave 2 is C alone on a main containing B.

## My merge procedure (lead reviewer = me, after all streams land)

1. Merge A → main (backend-only; pytest must be green).
2. Merge B → main (frontend-only; node:test + `astro check` green).
3. Rebase C onto new main (it was cut before/after B — either way I rebase,
   resolve, and re-run its gates; C's author never touches B's files).
4. Full gates: backend pytest, frontend tests, `astro check`, `astro build`,
   `git diff --check`; alembic `upgrade head` + `downgrade -1` on a scratch DB
   (migration both directions or the merge waits).
5. User-assisted browser matrix: reload-persistence (authed + guest-loss),
   forced-failure rollback per mutation, guest→login adopt, narrow viewport,
   clean console. Cross-device check if a second browser is handy.

## Risks

- C's call-site list grows beyond the prompt's allowance → split C, don't sprawl.
- Someone "fixes" the shared contract mid-stream → forbidden; the contract
  changes only by my explicit re-issue to all three streams.
- Alembic head conflicts if another migration lands first → mine to resolve at
  merge (linearize 0006 after the newcomer).
- Adopt-duplication across tabs (two tabs logging in simultaneously) → spec
  bounds it (per-chat all-or-nothing + server-wins hydrate); residual edge
  accepted and noted, not engineered away in this phase.
