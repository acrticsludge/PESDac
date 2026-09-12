# P3 — De-async DB path (session prompt)

```text
You are running Phase 3 of docs/reasonix/plans/api-latency-outbox-plan.md (T3.1, T3.2).
Context: docs/reasonix/specs/api-latency-outbox-build-spec.md §3. Repo root: C:\Anubhav\Web Dev Projects\PESDac.

Branch: create `sess/p3-threadpool` from current main. Never pull/merge any other sess/* branch. Merge order P1→P2→P3→P4→P5 (you merge before P4 — your hunks are signature lines, theirs are bodies).

SKILLS TO USE: using-agent-skills, source-driven-development (verify sync-def-route + async-dependency semantics against official FastAPI/Starlette docs — do NOT rely on memory), performance-optimization, test-driven-development, debugging-and-error-recovery, doubt-driven-development, incremental-implementation.

OWNERSHIP (exclusive, line-level — this is how you avoid colliding with the P4 session in the same files):
- OWN: the `async def`→`def` keyword line of route functions in backend/app/routers/*.py ONLY; the whole of backend/app/deps.py (you may wrap its sync DB section in to_thread); plus ONE new test file backend/tests/test_concurrency_repro.py.
- FORBIDDEN: route bodies, queries, return shapes, Query()/default lines, schemas, models, migrations, betterauth.py, config.py, db.py, all existing test files.

TASKS:
- T3.1: write the concurrency repro FIRST (N parallel DB-bound requests serializing on the loop) — it must FAIL on current code. It becomes the permanent regression guard.
- T3.2: flip DB-bound routes to sync `def` so Starlette runs them in its threadpool (sync routes may keep async dependencies — verify via docs per above); wrap leftover sync-in-async spots in to_thread only where a route must stay async. No query-logic changes.
- GATE INSIDE T3.2: if the threadpool saturates under realistic burst, STOP, report saturation numbers, do not stack further fixes — that outcome alone is a valid result.

DONE GATE (ALL must hold, else NOT DONE):
- `python -m pytest -q` (workdir backend/) → 0 failed, 0 errors, no tracebacks, no new warnings vs base. T3.1 repro fails before / passes after (show both).
- Envelopes byte-identical; before/after wall times recorded.
- `git status` shows ONLY your owned files.

REPORT BACK exactly: Implemented / Skills activated / Verification (exact commands + results + timings) / Saturation verdict (saturated? yes/no + numbers) / Remaining risks / READY TO MERGE or NOT READY.
```
