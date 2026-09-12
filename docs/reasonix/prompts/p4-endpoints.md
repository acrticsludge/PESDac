# P4 — Endpoint H-fixes (session prompt)

```text
You are running Phase 4 of docs/reasonix/plans/api-latency-outbox-plan.md (T4a–T4d; append slimming is P5's T5-pre, NOT yours).
Context: docs/reasonix/specs/api-latency-outbox-build-spec.md §4. Repo root: C:\Anubhav\Web Dev Projects\PESDac.

Branch: create `sess/p4-endpoints` from current main. Never pull/merge any other sess/* branch. Merge order P1→P2→P3→P4→P5 (you merge before P5; P5 rebases onto you).

SKILLS TO USE: using-agent-skills, api-and-interface-design, test-driven-development, deprecation-and-migration (you ship a migration), performance-optimization, security-and-hardening (validate new limit inputs), debugging-and-error-recovery, incremental-implementation.

OWNERSHIP (exclusive):
- OWN: route BODIES in backend/app/routers/chats.py EXCEPT the append_message function (untouchable — P5 owns it); export route body in backend/app/routers/users.py; Query()/default value lines (e.g. messages limit); index definitions in backend/app/models/*.py; ONE migration with revision id exactly `20260912_perf_indexes`.
- FORBIDDEN: `async def`/`def` keyword lines (P3's), the append_message function, deps.py, betterauth.py, config.py, db.py, frontend/. Existing contract tests: you MAY update only tests your tasks break (list/export defaults) — report each file touched. Your migration's down_revision = current head.

TASKS (one atomic commit each): T4a cap export (+index) / T4b lower messages default page (keep ceiling + envelope) / T4c purge pushed into SQL with chunked bulk DELETE / T4d composite (user_id,code) + export-sort/retention/subject indexes + trigram-GIN model↔migration drift fix. Measure (payload bytes, statement counts, EXPLAIN ANALYZE) before/after each.

DONE GATE (ALL must hold, else NOT DONE):
- `python -m pytest -q` (workdir backend/) → 0 failed, 0 errors, no tracebacks, no new warnings vs base.
- Migration upgrades AND downgrades cleanly; EXPLAIN outputs pasted in commit messages; no envelope/status changes.
- `git status` shows ONLY your owned files (+ reported test files).

REPORT BACK exactly: Implemented / Skills activated / Verification (exact commands + results + before/after numbers) / Test files touched (if any) + why / Remaining risks / READY TO MERGE or NOT READY.
```
