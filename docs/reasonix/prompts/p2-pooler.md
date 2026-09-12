# P2 — Pooled DB connection (session prompt)

```text
You are running Phase 2 of docs/reasonix/plans/api-latency-outbox-plan.md (T2.1, T2.2).
Context: docs/reasonix/specs/api-latency-outbox-build-spec.md §2. Repo root: C:\Anubhav\Web Dev Projects\PESDac.

Branch: create `sess/p2-pooler` from current main. Never pull/merge any other sess/* branch. Merge order P1→P2→P3→P4→P5.

SKILLS TO USE: using-agent-skills, test-driven-development, observability-and-instrumentation, performance-optimization, documentation-and-adrs (record the pool-size decision briefly), doubt-driven-development, incremental-implementation.

OWNERSHIP (exclusive):
- OWN: backend/app/db.py (whole file), pool-related env handling in backend/app/config.py, plus ONE new test file backend/tests/test_pool_config.py.
- FORBIDDEN: every other file. Never print or commit secret values (backend/.env holds live secrets — read structure only, log hostnames never credentials).

TASKS:
- T2.1: read DATABASE_URL_POOLED first with DATABASE_URL fallback; confirm the -pooler host is the effective URL (log host only). Direct URL remains fallback.
- T2.2: explicit small pool_size/max_overflow (a pooler sits in front — no double-pooling), explicit pool_timeout/pool_recycle/statement_timeout, lowered connect_timeout. Document chosen values + why in code comments.
- One atomic commit per task. No behavior change besides connection routing/timeouts.

DONE GATE (ALL must hold, else NOT DONE):
- `python -m pytest -q` (workdir backend/) → 0 failed, 0 errors, no tracebacks, no new warnings vs base.
- Boot log confirms pooler host in use; burst-checkout probe shows no 30s-queue behavior; cold-checkout timing recorded before/after.
- `git status` shows ONLY your owned files.

REPORT BACK exactly: Implemented / Skills activated / Verification (exact commands + results + timings) / Remaining risks / READY TO MERGE or NOT READY.
```
