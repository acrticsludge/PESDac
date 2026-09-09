# Muse Spark implementation prompt: Stream A — messages API (backend)

You are Muse Spark implementing in the PESDac repository. Work on medium
reasoning. Read these first, in order:

- `AGENTS.md` (UI rules — you touch no UI; backend-only)
- `docs/reasonix/specs/chat-persistence-sync.md` (§3 is your build order)
- `docs/reasonix/plans/chat-persistence-plan.md` (your stream row + merge order)

Key source files (open before editing):

- `backend/app/models/chats.py` (Chat model + DEMO_LABELS; Message goes here)
- `backend/app/schemas/chats.py` (ChatCreate/ChatPatch/ChatOut envelope style)
- `backend/app/routers/chats.py:38-135` (`_get_owned`, `_out`, origin+limit pattern)
- `backend/app/deps.py:22-46` (`_insert_or_select` retry doctrine to mirror)
- `backend/alembic/versions/0005_*.py` (migration style to copy)

Before touching code, run `git status --short`. Existing modified/untracked
files belong to the user or another run. Do not reset, clean, checkout,
overwrite, or commit them.

## Mission

Build §3 of the shared spec: `messages` table + migration + 3 endpoints +
contract tests. Nothing else.

## Hard constraints

- Touch ONLY: `backend/app/models/chats.py`, `backend/app/schemas/chats.py`,
  `backend/app/routers/chats.py`, one new `backend/alembic/versions/0006_*.py`,
  one new `backend/tests/test_messages_contract.py`. Touching anything else —
  especially anything under `frontend/` — means stop and report, not improvise.
- Contract is FROZEN: paths, statuses, envelopes, `MessageOut` keys, 100KB cap,
  60/60 buckets, UNIQUE(chat_id, seq) + retry ×3, `updated_at` touch, demo-code
  404s. If the contract is wrong somewhere, report it and stop that thread —
  do not "fix" the spec unilaterally (two other streams build against it).
- Copy-only error strings via `error_body`; same codes/messages as spec.
- No new dependencies. No changes to existing endpoints' behavior.
- Work on branch `fix/chat-messages-api` (create once from main with
  `git checkout -b`). Never touch main. Do not commit, push, or reset files.
- Synthetic fixtures only; no PII/secrets in tests.

## Required working method

Report after each unit (model+schemas / endpoints / migration / tests) with:

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

- Migration: `upgrade` + `downgrade` both verified (scratch SQLite is fine for
  the round-trip; Neon's real run happens at deploy). Linear `down_revision`
  off the current head — if the head isn't 0005, stop and report.
- `seq` assignment: `SELECT max+1` inside the request transaction, retry the
  whole append up to 3× on `IntegrityError` (race losers converge, never 500).
- `content` validation: must be a JSON object (dict) at the Pydantic layer;
  the 100KB serialized cap is enforced in the route (422, not 500, on excess).
- `GET` list returns `seq`-ascending with the slice-13 `{data, pagination}`
  envelope; default limit 200, max 200.
- `DELETE .../messages?from_seq=N`: `N >= 0` else 422; response mirrors
  `clear_chats` shape. Demo/static codes and foreign codes → 404, identical
  body to the existing `NOT_FOUND` (no oracle).
- Tests (TestClient, existing style): append→list round-trip with seq
  assignment; truncation deletes the tail only; cross-user code 404s; demo
  code 404s; oversize content 422s; bad role 422s; pin/archive/validation
  paths of existing chat tests still green unmodified.

## Commands

From `backend/`: `python -m pytest -q`. From repo root: `git diff --check`,
`git status --short`. Paste exact failures; never weaken tests to pass.

## Acceptance checklist

- Model + migration + 3 endpoints match §3 exactly; downgrade verified.
- Contract tests pin every row of the §3.2 table (success + each error).
- Full backend suite green; diff-check clean; zero frontend diffs.
- Final report: files changed, test results, any contract-defect reports (with
  file:line, no unilateral changes).
