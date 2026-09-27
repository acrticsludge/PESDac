# Agent Handoff: Retrieval Phase 1 (backend-only)

Copy-paste everything below the line into your next agent session.
It is self-contained — the agent needs no prior conversation.

---

You are implementing Retrieval Phase 1 for the PESDac repo (Windows,
PowerShell 5.1). Backend only. No frontend files, ever.

## 0. Setup (do this first, in order)

1. Repo: `C:\Anubhav\Web Dev Projects\PESDac`. Branch:
   `feat/retrieval-p1-backend` — check it out and pull; confirm with
   `git branch --show-current` and `git status --short`.
2. Read in this order (stop after each and confirm understanding):
   a. `docs/reasonix/specs/retrieval-phase1.md` — THE contract (§1–§14).
      It is complete and audited (two review passes + live Jev audit).
      Do not re-litigate its decisions; implement them.
   b. `tasks/plan-retrieval-p1.md` — 15 tasks, T1–T15, with the build
      sequence C2 → C1 → C3 → C4 → C6 → C5.
   c. `tasks/todo-retrieval-p1.md` — your checkbox list. Work top to
      bottom; check boxes only for actually-done, verified work.
   d. `backend/app/main.py`, `backend/app/deps.py`,
      `backend/app/cache.py` (first 120 lines + key builders),
      `backend/app/rate_limit.py` (`check` signature),
      `backend/tests/conftest.py` — the seams you will plug into.
3. Confirm the pre-existing state (already done, do NOT redo):
   Math→MFADS rename (backend migration `0011`, frontend strings,
   e2e C15) is committed and pushed. Suites were green at handoff
   (frontend 385/385, backend full pytest).

## 1. Hard rules (violations = stop and ask)

- **Backend-only diff.** `git status` must never show `frontend/`
  (except the pre-existing `playwright.config.ts` modification, which
  is not yours — leave it alone). Docs under `docs/` and scripts under
  `backend/scripts/` are allowed where the plan says so.
- **No secrets, ever.** Never read `.env` values into chat, never
  commit them (they are git-ignored — keep it that way). Never ask the
  user for API keys. P1 code paths must not read `TYPESAFE_API_KEY`.
- **Zero new runtime deps.** `backend/pyproject.toml` stays frozen;
  boto3/sentence-transformers are script-lazy only.
- **SQLite-compatible models.** `backend/tests/conftest.py` builds
  schema via `create_all`, never migrations. `vector(1024)`/HNSW/tsv
  live in `0012` behind a Postgres-dialect guard or the whole suite
  breaks. New models must import in `app/models/__init__.py` or tables
  silently never exist.
- **Follow existing idioms exactly**: `check_mutation_origin` walrus
  on all POSTs, `rate_limit.check(key, request, max, window)`,
  `error_body` envelopes (502/503 via direct `JSONResponse` like
  `routers/llm.py`, never `raise HTTPException` for those codes),
  `extra="forbid"` schemas, envelope `{data, pagination}` on lists.
- **Update the migration-chain pin** (`test_migration_chain.py`)
  in the same commit as any new migration.

## 2. Method (TDD, no exceptions)

- RED first: each task starts with a failing test. A test that passes
  immediately proves nothing. GREEN minimal. REFACTOR only while green.
- Test state, not interactions. DAMP tests (readable > DRY). Real
  implementations over mocks; `httpx.MockTransport` at the HTTP seam.
- New tests add **zero sleeps** (suite is already ~10 min).
- One behavior per test; names read like specification.

## 3. Commands (use these exactly)

- Focused: `python -m pytest tests/test_<name>.py -q` with
  `workdir` = `backend/`. Full: `python -m pytest -q` (slow, ~10 min —
  checkpoints only, never per task).
- `git diff --check` before every commit. Secret scan at every
  checkpoint: `python scripts/check_secrets.py` from repo root.
- Shell is PowerShell 5.1: no `tail`, no `&&` (use `;`),
  `.ps1` needs `-ExecutionPolicy Bypass`, prefer `node`/`python`
  binaries directly over `npm` (execution policy blocks `npm.ps1`).
- Commit per completed task (repo style: `feat(retrieval): …`,
  `test(retrieval): …`); push at checkpoints.

## 4. Task loop (repeat per task in `tasks/todo-retrieval-p1.md`)

1. Read the task + its spec section. State the acceptance criteria
   back in one line.
2. RED: write the failing test(s). Run focused suite — confirm FAIL.
3. GREEN: minimal implementation. Run focused suite — confirm PASS.
4. REFACTOR if needed (tests stay green).
5. `git diff --check`; tick the todo box; commit.
6. At checkpoints: full suite + secret scan + push, then report.

## 5. Definition of done (whole phase)

- All 15 boxes ticked with green runs behind each.
- Full backend suite green, secret scan clean, `git status` shows
  backend + docs + scripts only.
- Spec §9 boxes ticked. No merge — report ready-for-review and stop.

## 6. If stuck

- Ambiguity in the spec → re-read the cited section; the answer is
  usually there (caps, codes, and key formats are all pinned).
- Genuine gap (spec silent + blocks progress) → stop, write the
  smallest spec amendment as a proposal, and ask the user before
  implementing around it. Do not invent contracts.
- Failing pre-existing test unrelated to your diff → stash your
  changes, reproduce on clean tree, report; do not fix drive-by.
