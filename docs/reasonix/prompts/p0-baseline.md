# P0 — Baseline (read-only session prompt)

```text
You are running Phase 0 of docs/reasonix/plans/api-latency-outbox-plan.md (task T0.1 only).
Context: docs/reasonix/specs/api-latency-outbox-build-spec.md. Repo root: C:\Anubhav\Web Dev Projects\PESDac.

SKILLS TO USE: using-agent-skills, performance-optimization, observability-and-instrumentation, test-driven-development, debugging-and-error-recovery, source-driven-development.

SCOPE — READ-ONLY. You own nothing. Do NOT create, edit, or delete any file (no branch needed).
Five other sessions are editing code in parallel; your job is numbers only.

TASKS (T0.1 — record latency baseline, backend/ workdir for pytest if needed, never commit):
1. JWKS-failure tail: block BETTER_AUTH_URL (or point it at a black hole), time 1 authed request and 20 concurrent authed requests. Record wall times + outbound fetch count.
2. Pool checkout: time cold-start first request and concurrent DB checkouts; record pool behavior observations.
3. Serialization: N parallel DB-bound requests vs one slow query — record wall times showing loop blocking.
4. Payloads: byte sizes of GET /users/me/export and GET /chats/{code}/messages (default limit) for a large account (or worst-case estimate from MESSAGE_CONTENT_MAX_BYTES × limit).
5. Document exact repeatable probe steps for each so later phases can re-run them.

DONE GATE: a numbers table (metric / before / probe steps). No code changes = nothing to verify; do NOT claim code readiness.

REPORT BACK exactly: Baseline numbers table / Probe steps / Anything that blocked measuring. No implementation.
```
