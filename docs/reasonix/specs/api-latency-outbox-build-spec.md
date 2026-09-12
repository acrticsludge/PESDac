# Build Spec — API latency fixes + optimistic outbox (2026-09-12)

Status: Proposed

## 0. Problem, goals, non-goals

**Problem:** Some API responses take up to 10 seconds (p99 tail); writes feel
slow and fail visibly on flaky networks.

**Goals:**

- Kill the 10s tail on authed endpoints and DB-bound routes.
- Make writes feel instant and survive flaky networks / reloads.
- No API envelope, status-code, or error-shape changes.
- SQLite test parity preserved; smallest operational complexity that moves p99.

**Non-goals (deferred, with exit criteria):** full async-engine rewrite, Redis,
job queue / workers, read replicas, streaming / WebSocket. Revisit only if the
proof metrics in §6 say items §1–§5 were insufficient.

**Constraints (hard):**

- Backend only (`backend/`); no `frontend/` redesign. Frontend outbox work in
  §5 touches existing sync modules only, no visual changes.
- Never log tokens, claims, or request bodies; keep 401 categories generic.
- Smallest diff per workstream; no speculative refactors.

---

## 1. JWKS hardening (the 10s smoking gun)

**What:** In `backend/app/auth/betterauth.py` — singleflight lock around the
JWKS fetch, short-TTL negative cache on fetch failure (fail fast instead of a
second 5s fetch), reduce fetch timeout toward ~2s (verify against the ~3s cold
fetch noted in `main.py` before lowering), reuse one shared `httpx.AsyncClient`
with keep-alive instead of constructing one per fetch.

**Acceptance:**

- JWKS outage → fast generic 401 (seconds, not ~10s).
- N concurrent requests at TTL expiry → exactly 1 outbound fetch.
- Happy-path behavior, allow-list, and log categories unchanged.

**Verify:** existing auth/JWT tests green + manual: block `BETTER_AUTH_URL`,
time 1 authed request and 20 concurrent ones.

**Upside:** removes the literal 5s+5s sequential-fetch mechanism — the single
biggest tail-latency win, ~20 lines, zero infra.

---

## 2. Pooled DB connection + explicit pool settings

**What:** Prefer the already-existing `DATABASE_URL_POOLED` (today `db.py`
only reads `DATABASE_URL`; confirm the `-pooler` host), keep the app-side pool
small to avoid double-pooling, set explicit `pool_size / max_overflow /
pool_timeout / pool_recycle / statement_timeout`, lower `connect_timeout`.

**Files:** `backend/app/config.py`, `backend/app/db.py`.

**Acceptance:** cold-checkout latency down; burst load no longer queues behind
default 30s pool timeouts; pooled host confirmed in use.

**Verify:** pool-checkout timing under concurrent load; cold-start first-request
timing.

**Upside:** kills connection-acquisition stalls and cold-connect spikes — the
classic invisible p99 driver — for essentially a config change, no new service.

---

## 3. De-async the DB path (concurrency fix without a rewrite)

**What:** Convert DB-bound routes from `async def` to sync `def` so Starlette
runs them in its threadpool (or wrap sync DB calls in `to_thread` where the
route must stay async for JWKS). No query-logic changes, no new driver.

**Files:** `backend/app/routers/*.py`, `backend/app/deps.py`.

**Acceptance:** one slow Neon query no longer serializes all concurrent
requests; identical envelopes; tests green on SQLite.

**Verify:** concurrency repro — N parallel requests against one
artificially-slowed query, before/after wall times.

**Upside:** removes event-loop head-of-line blocking and tells us whether the
full async-engine rewrite is ever needed (it isn't, unless the threadpool
itself saturates). Near-zero risk, no migration.

---

## 4. Endpoint H-fixes (bounded work, index-backed queries)

- **4a. Cap `GET /users/me/export`** (`routers/users.py:34-45`): paginate or
  hard-cap chats/demos; add index covering the export sort.
  **Upside:** unbounded multi-MB responses become bounded; export stops growing
  with account age.
- **4b. Lower `GET .../messages` default limit** (`routers/chats.py:310-326`,
  currently 200 × up-to-100KB): smaller default page.
  **Upside:** kills worst-case ~20MB JSON responses holding workers for seconds.
- **4c. Push purge into SQL** (`routers/chats.py:78-103`): cutoff in `WHERE`,
  chunked bulk `DELETE` instead of fetch-all + Python filter + per-row delete.
  **Upside:** O(N) round-trips collapse to a few statements; no long
  lock-holding transaction.
- **4d. Index fixes:** composite `(user_id, code)` for `_get_owned`, indexes
  for export sort / `retention` / `subject`, resolve trigram-GIN drift
  (migration-only today, missing from models).
  **Upside:** ownership lookups, sorts, and `ilike` search stop degrading with
  table growth — proven per item via `EXPLAIN ANALYZE`.
- **4e. Slim the append path** (`routers/chats.py:273-306`): collapse
  MAX+COUNT+double-refresh RTTs while keeping seq race safety.
  **Upside:** fewer serialized round-trips on the hottest write path.

---

## 5. Optimistic durable outbox (perceived latency + resilience)

- **5a. `clientMsgKey` idempotency on message append** (backend, mirroring the
  existing `clientAdoptKey` precedent on chat create): unique key per chat,
  return-existing on conflict.
  **Upside:** makes client retries safe — without it, every timeout-retry risks
  a duplicate message. Hard prerequisite for 5b–5d.
- **5b. In-memory optimistic queue + per-item error states** (frontend, extends
  today's paint-then-persist in `ThreadView.tsx`): `pending → sent |
  failed-retryable | failed-fatal`, inline retry affordances, toasts.
  **Upside:** writes feel instant; failures are local, named, and recoverable
  instead of a dead spinner.
- **5c. Durable outbox in IndexedDB + paced flush worker** (not localStorage —
  sync API, ~5MB quota vs 100KB messages): FIFO per chat, chat-create acks
  before its messages, honors rate limits / `Retry-After`, reuses the
  retryable/non-retryable taxonomy in `frontend/src/lib/auth.ts`. Flush on
  `online` / focus / interval.
  **Upside:** user actions survive reloads and network drops; unsynced work
  drains invisibly; server p99 matters less to perceived UX.
- **5d. Cross-tab single-flusher + outbox cap + "N unsynced" indicator.**
  **Upside:** no duplicate flushes or ordering fights across tabs; bounded disk
  use; the user always knows sync state.

**Explicitly out of scope:** delete-account (already retry-safe 204, stays
synchronous), export (a read — cap it per 4a, don't queue it), auth/profile
convergence (server-owned). No tokens in durable storage; chat-body persistence
gets a documented tradeoff note given the counts-only localStorage precedent
(`Pesdac.tsx:893`).

---

## Rollout order and dependencies

`§1 → §2 → §3 → §4 → §5a → §5b → §5c → §5d`. Each step independently shippable
and verifiable. Hard edges: §5c must not ship before §5a (unsafe retries);
§3's measurement decides whether the async rewrite stays deferred.

## Proof metrics (what "done" looks like per item)

| Item | Metric | How |
| ---- | ------ | --- |
| §1 | p99 authed-endpoint latency under JWKS failure; fetch count under burst | block JWKS URL, time 1 + 20 concurrent requests |
| §2 | pool-checkout wait, cold-start time | concurrent-load timing, first-request timing |
| §3 | wall time of N parallel slow queries | concurrency repro before/after |
| §4a–e | payload bytes, statement count, `EXPLAIN ANALYZE` | per-endpoint before/after |
| §5a | zero duplicates under forced timeout-retry | drop connection mid-append, retry, count rows |
| §5b–d | perceived write latency, unsynced-drain success | UX timing, offline→online drain test |

## Risks

Thin per item: §1 changes failure timing (fast 401 — intended); §2 needs the
`-pooler` host confirmed; §3 threadpool can itself saturate (that is the signal
for the rewrite); §4e must preserve seq safety; §5c/§5d add client complexity —
capped by keeping the outbox pending-ops-only, never a data mirror.
