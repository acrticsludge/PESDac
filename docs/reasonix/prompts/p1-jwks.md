# P1 — JWKS hardening (session prompt)

```text
You are running Phase 1 of docs/reasonix/plans/api-latency-outbox-plan.md (T1.1, T1.2).
Context: docs/reasonix/specs/api-latency-outbox-build-spec.md §1. Repo root: C:\Anubhav\Web Dev Projects\PESDac.

Branch: create `sess/p1-jwks` from current main. Never pull/merge any other sess/* branch. Merge order is P1→P2→P3→P4→P5 (you merge first).

SKILLS TO USE: using-agent-skills, security-and-hardening (this is auth code — non-negotiable), test-driven-development, debugging-and-error-recovery, performance-optimization, observability-and-instrumentation, doubt-driven-development, incremental-implementation.

OWNERSHIP (exclusive — touch nothing else):
- OWN: backend/app/auth/betterauth.py (whole file), plus ONE new test file backend/tests/test_jwks_resilience.py.
- FORBIDDEN: every other file, including backend/app/deps.py, routers, db.py, config.py, existing test files.

TASKS:
- T1.1: singleflight lock around the JWKS fetch + short-TTL negative cache on fetch failure (a failed fetch must fail fast instead of triggering an immediate second 5s fetch from the unknown-kid retry path). Happy path, algorithm allow-list, and log categories unchanged.
- T1.2: shared httpx.AsyncClient with keep-alive; review the 5s timeout against the measured ~3s cold fetch — lower toward ~2s ONLY if cold fetch still succeeds, otherwise keep 5s and rely on T1.1. Lifespan warmup stays failure-tolerant.
- One atomic commit per task. No envelope/status/error-shape changes. No secrets in logs. SQLite parity intact.

DONE GATE (ALL must hold, else NOT DONE — keep working, never report success early):
- `python -m pytest -q` (workdir backend/) → 0 failed, 0 errors, no tracebacks in output, no new warnings vs base.
- Manual probes: blocked JWKS URL → 1 request 401s in ~one timeout (not ~two); 20 concurrent requests at TTL expiry → exactly 1 outbound fetch; cold start still succeeds.
- `git status` shows ONLY your owned files.

REPORT BACK exactly: Implemented / Skills activated / Verification (exact commands + results + before/after timings) / Security notes / Remaining risks / READY TO MERGE or NOT READY.
```
