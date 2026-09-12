# Implementation Plan — API latency fixes + optimistic outbox (2026-09-12)

Source spec: `docs/reasonix/specs/api-latency-outbox-build-spec.md` (Status: Proposed).
Plan status: Proposed. Small, independently verifiable tasks in dependency order.
No API envelope / status-code / error-shape changes in any task. SQLite test
parity required for every backend task.

Conventions: backend verify runs with workdir `backend/`; frontend verify runs
with workdir `frontend/`. One task = one atomic commit. Measure before/after
where a task claims a latency win.

---

## Phase 0 — Baseline (measure before optimizing)

### T0.1 Record latency baseline
- **Objective:** capture before-numbers for JWKS-failure tail, pool checkout,
  concurrent-request serialization, export/messages payload sizes.
- **Files/areas:** none (read-only probes: block `BETTER_AUTH_URL`, N-parallel
  requests vs one slow query, response byte sizes on export + messages).
- **Dependencies:** none.
- **Acceptance:** baseline numbers written into the final report (p99-ish tail,
  checkout time, serialized-vs-parallel wall times, payload bytes).
- **Verify:** repeatable manual probe steps documented in the task commit message.
- **Rollback:** n/a (no code change).

---

## Phase 1 — JWKS hardening (spec §1)

### T1.1 Singleflight lock + negative cache
- **Objective:** concurrent JWKS fetches collapse to one; a failed fetch fails
  fast for a short window instead of triggering an immediate second 5s fetch.
- **Files:** `backend/app/auth/betterauth.py` (module globals + `_get_jwk_for_async`).
- **Dependencies:** T0.1.
- **Acceptance:** block JWKS URL → 1 request 401s in ~one timeout (not ~two);
  20 concurrent requests at TTL expiry → 1 outbound fetch; happy path unchanged.
- **Verify:** `python -m pytest tests/test_jwt_verifier_unit.py tests/test_startup_warmup.py -q` + manual block/burst probe.
- **Rollback:** revert single commit; previous behavior (slow 401) returns, no schema impact.

### T1.2 Shared HTTP client + timeout review
- **Objective:** reuse one `httpx.AsyncClient` (keep-alive) for JWKS fetches;
  decide timeout value against the measured ~3s cold fetch — lower only if
  measurement allows, otherwise keep 5s and rely on T1.1.
- **Files:** `backend/app/auth/betterauth.py` (`_fetch_jwks`, `warm_jwks_cache`).
- **Dependencies:** T1.1.
- **Acceptance:** cold fetch succeeds (no timeout regression); connection reuse
  observable; lifespan warmup still failure-tolerant.
- **Verify:** same pytest subset as T1.1 + cold-start timing.
- **Rollback:** revert single commit.

---

## Phase 2 — Pooled DB connection (spec §2)

### T2.1 Prefer `DATABASE_URL_POOLED`
- **Objective:** read `DATABASE_URL_POOLED` first (fallback: `DATABASE_URL`);
  confirm `-pooler` host in the effective URL at startup log (host only, never
  credentials).
- **Files:** `backend/app/config.py`, `backend/app/db.py`.
- **Dependencies:** T0.1.
- **Acceptance:** app boots against the pooler URL; direct URL remains fallback;
  no secret values in logs.
- **Verify:** `python -m pytest -q` (full backend suite) + boot log check.
- **Rollback:** revert commit or unset `DATABASE_URL_POOLED`.

### T2.2 Explicit pool settings
- **Objective:** set small `pool_size / max_overflow`, explicit `pool_timeout /
  pool_recycle / statement_timeout`, lower `connect_timeout`; document chosen
  values and why (pooler in front → small app pool).
- **Files:** `backend/app/db.py`.
- **Dependencies:** T2.1.
- **Acceptance:** burst load no longer queues behind 30s defaults; cold checkout
  bounded and fast.
- **Verify:** full backend suite + concurrent-checkout timing probe.
- **Rollback:** revert single commit.

---

## Phase 3 — De-async DB path (spec §3)

### T3.1 Concurrency repro (proves the bottleneck)
- **Objective:** failing-first repro showing N parallel DB-bound requests
  serializing on the event loop (before-numbers for T3.2).
- **Files:** `backend/tests/` (new repro test, marked/slow if needed).
- **Dependencies:** none (parallelizable with Phase 1–2).
- **Acceptance:** repro fails (serialized wall time) on current code.
- **Verify:** `python -m pytest tests/<new-repro> -q` fails before, passes after T3.2.
- **Rollback:** delete repro file (keep it — it becomes the regression guard).

### T3.2 Threadpool the sync DB calls
- **Objective:** convert DB-bound routes to sync `def` (Starlette threadpool) or
  wrap sync DB calls in `to_thread` where the route must stay async for JWKS.
  No query-logic changes.
- **Files:** `backend/app/routers/*.py`, `backend/app/deps.py`.
- **Dependencies:** T3.1.
- **Acceptance:** T3.1 repro passes; envelopes identical; full suite green.
- **Verify:** `python -m pytest -q` + T3.1 repro timing before/after.
- **Rollback:** revert commit(s). **Gate:** if the threadpool saturates under
  realistic burst, stop here and escalate to the deferred async-engine rewrite
  (do not stack more fixes on a saturated pool).

---

## Phase 4 — Endpoint H-fixes (spec §4)

T4a–T4d independently shippable; order by payoff. Append-path slimming lives
in Phase 5 as T5-pre — P5 owns the append route exclusively so parallel
sessions never edit the same function.

### T4a Cap export
- **Objective:** paginate/hard-cap `GET /users/me/export` chats + demos; index
  the export sort.
- **Files:** `backend/app/routers/users.py`, migration for index, models if needed.
- **Dependencies:** none (parallelizable).
- **Acceptance:** bounded response size for large accounts; same shape.
- **Verify:** `python -m pytest tests/test_demo_users_contract.py -q` + full suite + payload bytes before/after.
- **Rollback:** revert commit + `alembic downgrade -1` if a migration shipped.

### T4b Lower messages default page
- **Objective:** reduce `GET .../messages` default limit; keep `le=200` ceiling
  and envelope.
- **Files:** `backend/app/routers/chats.py`.
- **Dependencies:** none.
- **Acceptance:** worst-case payload bounded; pagination metadata still correct.
- **Verify:** `python -m pytest tests/test_messages_contract.py tests/test_chats_contract.py -q`.
- **Rollback:** revert single commit.

### T4c Purge in SQL
- **Objective:** cutoff in `WHERE`, chunked bulk `DELETE`; no Python-side
  filter, no per-row delete, short transactions.
- **Files:** `backend/app/routers/chats.py` (`purge_expired_chats`).
- **Dependencies:** none (unscheduled path — zero prod traffic risk).
- **Acceptance:** same `{retention: deleted}` return; statement count O(chunks).
- **Verify:** `python -m pytest tests/test_chat_lean_storage.py -q` + full suite.
- **Rollback:** revert single commit.

### T4d Index fixes
- **Objective:** composite `(user_id, code)`, export-sort / `retention` /
  `subject` indexes, resolve trigram-GIN migration↔model drift.
- **Files:** `backend/app/models/*.py`, new Alembic migration.
- **Dependencies:** none.
- **Acceptance:** `EXPLAIN ANALYZE` shows index use on ownership lookup, export
  sort, and title search; SQLite suite still green.
- **Verify:** full backend suite + `EXPLAIN` outputs pasted in commit message.
- **Rollback:** `alembic downgrade -1` + revert.

## Phase 5 — Optimistic durable outbox (spec §5)

P5 owns the `append_message` route in `backend/app/routers/chats.py`
exclusively (slimming + idempotency land as one coherent edit).

### T5-pre Slim append path (moved from Phase 4 for parallel-safety)
- **Objective:** collapse MAX+COUNT+double-refresh RTTs on message append,
  preserving seq race safety and throwaway-retry semantics.
- **Files:** `backend/app/routers/chats.py` (append route only).
- **Dependencies:** none inside this session (P4's T4d index, merged separately,
  only makes the remaining MAX query faster — this task is correct with or
  without it).
- **Acceptance:** same 201 body + conflict behavior under concurrent appends;
  fewer statements per append.
- **Verify:** `python -m pytest tests/test_messages_contract.py tests/test_chats_adopt_idempotency.py -q` + statement count before/after.
- **Rollback:** revert single commit.

### T5a `clientMsgKey` idempotency (backend prerequisite — nothing else in §5 ships before this)
- **Objective:** client-supplied idempotency key on message append, unique per
  chat, return-existing on conflict — mirrors the `clientAdoptKey` precedent.
- **Files:** `backend/app/models/chats.py`, `backend/app/schemas/chats.py`,
  `backend/app/routers/chats.py`, new Alembic migration.
- **Dependencies:** T5-pre (same session).
- **Acceptance:** retry-after-timeout returns the original row, zero duplicates;
  contract tests cover conflict + happy path.
- **Verify:** `python -m pytest tests/test_messages_contract.py -q` + new
  duplicate-retry test (drop connection mid-append, retry, count rows == 1).
- **Rollback:** `alembic downgrade -1` + revert. Old clients omitting the key
  keep working (key optional at first, enforced later).

### T5b In-memory optimistic queue + error states (frontend)
- **Objective:** per-item `pending → sent | failed-retryable | failed-fatal`
  states on writes, extending the existing `ThreadView` optimistic paint +
  `retryText` patterns; toasts for failures. No visual redesign.
- **Files:** `frontend/src/lib/chat-sync.ts`, `frontend/src/components/chat/ThreadView.tsx` (minimal extension).
- **Dependencies:** none (works pre-T5a; T5a makes its retries safe).
- **Acceptance:** failed writes show inline retry affordance; fatal vs retryable
  distinguished; no duplicate on manual retry.
- **Verify:** `npm test` (workdir `frontend/`) + `npm run build`.
- **Rollback:** revert commit(s).

### T5c IndexedDB outbox + paced flush worker (frontend)
- **Objective:** durable pending-ops outbox (ops only, never a data mirror) in
  IndexedDB; FIFO-per-chat drain; chat-create acks before its messages; paced
  flush honoring rate limits / `Retry-After` and the `auth.ts` retry taxonomy;
  flush triggers on `online` / focus / interval.
- **Files:** new `frontend/src/lib/outbox*.ts` + wiring in `chat-sync.ts`; tests
  in `frontend/tests/`.
- **Dependencies:** T5a (safe retries), T5b (status UI it reports into).
- **Acceptance:** actions survive reload and offline gaps; drain deletes on ack;
  no tokens in storage; quota-safe (payloads in IndexedDB, flags only elsewhere).
- **Verify:** `npm test` + offline→online drain test + reload-recovery test.
- **Rollback:** revert commit(s); server state untouched (outbox is client-only).

### T5d Cross-tab single-flusher + cap + indicator
- **Objective:** one flushing tab at a time (leader election / BroadcastChannel);
  outbox size cap with eviction policy; visible "N unsynced" state.
- **Files:** `frontend/src/lib/outbox*.ts`.
- **Dependencies:** T5c.
- **Acceptance:** two tabs → single flush stream, no ordering fights; cap
  enforced with user-visible state.
- **Verify:** `npm test` + two-tab manual check.
- **Rollback:** revert commit(s).

---

## Sequencing and gates

```
T0.1 (read-only) ─┬─▶ P1: T1.1 ▶ T1.2
                  ├─▶ P2: T2.1 ▶ T2.2
                  ├─▶ P3: T3.1 ▶ T3.2 ──(pool-saturation gate)
                  ├─▶ P4: T4a–T4d (any order)
                  └─▶ P5: T5-pre ▶ T5a ▶ T5b ─▶ T5c ─▶ T5d
                        (T5b parallelizable with T5-pre/T5a inside the session)
```

- Phase 1–3 and T4a–d are mutually parallelizable; the chain above is the
  recommended review order, not a hard dependency (except where noted).
- **Hard gates:** T5c waits on T5a. T3.2's saturation check decides the fate of
  the deferred async rewrite. Nothing in Phase 5 changes request/response
  contracts. **Merge order for parallel sessions:** P1, P2, P3, P4, then P5 —
  P5 rebases onto merged P4, re-points its migration onto P4's head, and
  re-runs the full suite before reporting READY.
- **Done criteria per task:** acceptance met + verify commands green + atomic
  commit + before/after numbers where latency is claimed.

## Deferred (exit criteria to revisit)

Async-engine rewrite (only if T3.2 proves threadpool saturation), Redis
(multi-worker herd proven), job queue (export still slow post-T4a), read
replica (writes proven starved by reads), streaming/WebSocket (real-time
requirement lands). Each needs a measurement, not a hunch.
