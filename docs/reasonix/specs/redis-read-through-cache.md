# Spec: Upstash REST read-through cache for hot API reads

Status: Proposed.

Supersedes the Redis deferrals: `api-latency-outbox-build-spec.md`
§Non-goals ("Revisit only if the proof metrics in §6 say items §1–§5
were insufficient") and `caching-audit.md` §11 ("add Redis only on
measured p95 latency evidence with a per-user key prefix +
write-through invalidation owned by the routers"). That evidence now
exists — §1. This spec follows the prescribed shape exactly.

## 1. Measured evidence (2026-09-13, `backend/app/timing.py`)

Backend dev (India) → Neon us-west-2. `db_ms` counts statement
execution only, not pool-checkout waits.

| Endpoint | total_ms | db_ms | queries | Verdict |
|---|---|---|---|---|
| `GET /api/v1/chats` | 1399.8 / 2861.6 | 1091.9 / 772.9 | 3 | DB-bound |
| `GET /api/v1/chats?archived=true&limit=50&offset=0` | 1361.5 | 1083.0 | 3 | DB-bound |
| `GET /api/v1/profiles/me` | 2635.3 | 522.2 | 2 | 2.1 s non-DB residual |
| `GET /api/v1/auth/me` | 2718.3 | 539.4 | 2 | 2.1 s non-DB residual |
| `GET /api/v1/chats/4qo2jq/messages` | ERR 1844.8 | 1312.7 | 4 | was 500 (fixed, §2) |
| `GET /api/v1/ready` (probe) | 782.3 | 515.8 | 1 | per-query floor |

Reads:

- **Per-query floor ≈ 300–500 ms** (single `SELECT 1` = 516 ms).
  Pure geography (India → us-west-2). Every endpoint pays it per
  roundtrip — this is what the cache erases on hits.
- **The ~2.1 s residual is checkout queueing, not per-request work.**
  One `/chats` call shows only 0.3 s residual, so JWKS/auth (cached,
  local) is fine. Page load fans out 4–6 parallel authed calls against
  a 5+5 pool where each checkout holds a connection through ~1 s of
  RTT-bound statements; later arrivals queue for a free connection,
  and that wait is outside `db_ms`. Fewer roundtrips + shorter holds
  (what this cache buys) drain that queue too.
- **Schema is now fixed.** The messages 500 was Neon sitting at
  migration `0008` (two behind head). `alembic upgrade head` applied
  `20260912_perf_indexes` + `20260912_msg_client_key`; Neon verified
  at head with all four read indexes present. The cache builds on
  indexed queries — no cache work papers over a missing index.

## 2. Goals / non-goals

Goals:

- Cut p50/p95 on the three proven legs (chat list, message windows,
  profile) to ~1 Upstash REST roundtrip on hits.
- Zero behavior change on misses, on Redis outage, and when unconfigured.
- No envelope, status-code, or error-shape changes (parent-spec hard
  constraint holds).
- SQLite test parity; no new production dependency (Upstash REST over
  the already-required `httpx`).

Non-goals (deferred with exit criteria, as before):

- Server write-behind / async persistence. Writes already feel
  instant via the browser IndexedDB outbox + idempotency keys
  (`clientAdoptKey`, `clientMsgKey`); a second write-behind would add
  a data-loss window for no UX gain. Revisit only on measured write
  latency evidence.
- Phase 2 (named, not specified here): rate-limit buckets in Redis
  (`rate_limit.py` already documents the multi-worker need), JWKS
  sharing across workers, pub/sub invalidation for multi-instance
  deploys, export caching.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Upstash **REST API** via existing `httpx` (sync client), not TCP/`redis-py` | Zero new dependencies (repo constraint); sync client matches the sync-SQLAlchemy-in-threadpool model — no loop juggling; Upstash console issues REST URL + token directly |
| D2 | **Envelope caching**: cache the exact response dict per endpoint | One cache op per endpoint regardless of query count; byte-identical bodies on hit vs miss (testable); zero frontend diff |
| D3 | **Per-user key prefix, always** (`caching-audit.md` P0 lineage) | Keys embed our `users.id`; a missing scope = wrong-user leak. No code-only or global keys, even though `code` is globally unique |
| D4 | **Routers own write-through invalidation** (prescribed shape) | Mutation handlers delete affected keys in the same request, after commit. No TTL-only correctness anywhere |
| D5 | **Fail-open everywhere**: unset URL, down/slow Redis, bad payload → DB path, one warn line | Cache must never 500 a request or change behavior when absent (SQLite tests run with no URL) |
| D6 | Short TTLs (30–120 s, §7), writes invalidate immediately | TTL bounds only cross-device/purge staleness; worst visible staleness ≈ TTL + the client's 60 s foreground-refetch floor |
| D7 | No negative caching; only `200`-dict GETs cached | 404s (incl. the no-existence-oracle rule), 4xx/5xx/429s, and all mutations always execute live |
| D8 | Sync `httpx.Client` singleton, 1 s connect / 1 s read timeout, no retry | Fail fast to DB; a retry would double the worst case on outage. Keep-alive mirrors the JWKS shared-client pattern |
| D9 | `CACHE_MAX_BYTES = 1_000_000`: oversize envelopes served, never stored | A 50×100 KB message window must not become a 5 MB value; guard is one `len()` check |
| D10 | No stampede singleflight in v1 | Single-digit concurrency makes concurrent-miss storms theoretical; revisit trigger: log-observed miss bursts on one key |

## 4. Audit: read inventory (cache candidates)

All paths already scoped by `get_current_user` (`backend/app/deps.py:96-130`).
Query counts measured live except where noted.

| Endpoint (router:lines) | Statements | Measured | Cache? |
|---|---|---|---|
| `GET /chats` (`routers/chats.py:151-170`): COUNT (L166) + page (L167-169); filters `archived/subject/q/limit/offset` | 3 (incl. user upsert select) | 1361–2862 total | **YES**, §6 key K1, TTL 30 s |
| `GET /chats/{code}/messages` (`routers/chats.py:358-376`): `_get_owned` (L369) + COUNT (L372) + page (L373-375), `limit≤200` default 50 | 4 | ERR pre-fix; slowest read | **YES**, §6 key K2, TTL 60 s |
| `GET /profiles/me` (`routers/profiles.py:25-28`): user + `get_or_create_profile` | 2 | 2635 total | **YES**, §6 key K3, TTL 60 s. First-ever call provisions the row via the miss path (handler runs fully, then populates) — correct by construction |
| `GET /demo-state` (`routers/demo_state.py:29-32`): user + full override list | 2 | unmeasured, ~1 s est. | **YES**, §6 key K4, TTL 120 s. Tiny rows, same 500 ms RTT tax per call |
| `GET /auth/me` (`routers/auth.py:28-43`): user upsert + profile provision + display-name remirror (writes!) | 2 | 2718 total | **NO** — identity-provisioning path; runs ~once per login and the frontend already memory-caches the session. Caching bootstrap risks provisioning bugs for zero repeated-read benefit |
| `GET /users/me/export` (`routers/users.py:41-62`): profile + ≤200 chats + ≤200 demos | 4+, largest payload | unmeasured | **NO** — rare op, large values, and T22 semantics promise "always current rows" |
| `GET /health`, `/ready` (`routers/health.py:16-35`) | 0 / 1 | — | **NO** — readiness must be live; health is trivial |
| All mutations + 4xx/5xx/429s | — | — | **NO** (D7) |

Frontend contract untouched: `chat-sync.ts:1-6` stays thin pass-through
(no-cache rule, `caching-audit.md` §9); memory cache + 60 s foreground
refetch + outbox behavior identical — envelopes don't change, so the
client cannot tell hit from miss.

## 5. Audit: write inventory (invalidation obligations)

| Mutation (router:lines) | Keys to delete (after commit) |
|---|---|
| `POST /chats` (`chats.py:173-218`), incl. adopt conflict-200 (§5 note) | K1 `*` (all filter variants for this user) |
| `PATCH /chats/{code}` (`chats.py:221-240`; archive flips lists) | K1 `*` |
| `DELETE /chats/{code}` (`chats.py:243-252`) | K1 `*` + K2 `{code}:*` |
| `DELETE /chats` clear (`chats.py:255-271`) | K1 `*` + K2 `*` (profile/demos untouched — clear is chats-only) |
| `POST /chats/{code}/messages` (`chats.py:274-355`), incl. key conflict-200 | K2 `{code}:*` + K1 `*` (preview/counts/seq/order all move) |
| `DELETE /chats/{code}/messages` truncate (`chats.py:379-419`) | K2 `{code}:*` + K1 `*` (same reason) |
| `PATCH /profiles/me` (`profiles.py:31-44`) | K3 (single key, no scan) |
| `PUT /demo-state/{label}` (`demo_state.py:35-56`) | K4 (single key) |
| `DELETE /users/me` (`users.py:65-79`) | entire user prefix (account gone; cascade deletes everything) |
| `purge_expired_chats` (`chats.py:78-118`, scheduler unwired) | at wire-up time: whole prefix per affected user (collect from purge chunks); until then TTLs are the backstop |
| `POST /auth/logout` (no-op), rate-limit 429s, 403 origin denials | nothing (no state change) |

Notes:

- Invalidation is unconditional on the mutation path (even on
  conflict-200 replays): the keys were already invalidated by the
  original write, so re-deleting is a harmless no-op — one code path,
  no "was it a replay?" branching.
- Accepted residual (documented, bounded by TTL): read-miss → DB →
  populate can interleave with a concurrent write (stale write lands
  after the delete). Single-human writers make this rare; TTLs bound
  it to ≤60 s. Same residue class the audit already accepts
  client-side. Revisit trigger: observed stale-after-write reports.
- `OPTIONS` preflights never touch the cache (no DB, measured 0.5 ms).

## 6. Key schema + serialization

```
pesdac:v1:{u:<user_uuid>}:chats:list:<sha1hex12>
pesdac:v1:{u:<user_uuid>}:msgs:<code>:<limit>:<offset>
pesdac:v1:{u:<user_uuid>}:profile
pesdac:v1:{u:<user_uuid>}:demos
```

- `{u:<uuid>}` doubles as a cluster hash-tag, so a future cluster
  migration needs no key changes.
- List filter hash: `sha1("a=0/1|s=<subject>|q=<strip().lower()>|l=<n>|o=<n>")[:12]`.
  `ilike` is case-insensitive, so lowercasing is hit-safe; hashing
  keeps keys bounded and search strings (user text) out of key names.
  `code` needs no hash (validated 6-char on the only path that caches).
- Values: `json.dumps` of the exact response dict. Assert
  JSON-serializable at write time (test); all four envelopes are
  strings/ints/bools/lists/dicts today (`_out`, `_msg_out`,
  `profile_to_out`, `_out` demo).
- `v1` bumps on any envelope/shape change — one constant, total
  invalidation by rename.
- Prefix deletes via `SCAN MATCH COUNT 100` loop + `DEL` (keys per
  user are in the hundreds; single-key `DEL` where the key is exact:
  K3, K4).

## 7. TTLs

| Key | TTL | Rationale |
|---|---|---|
| K1 chat lists | 30 s | Highest churn (every append/patch moves ordering); writes invalidate anyway — TTL only bounds cross-device staleness |
| K2 message windows | 60 s | Append/truncate invalidate; windows are otherwise append-only |
| K3 profile | 60 s | Matches client refetch floor; PATCH invalidates |
| K4 demos | 120 s | Rarely change; PUT invalidates |

## 8. `app/cache.py` shape (new module, stdlib + httpx only)

- `get_json(key) -> (hit: bool, value)` / `set_json(key, value, ttl_s)`
  (skips when `len(payload) > CACHE_MAX_BYTES`, outcome SKIP) /
  `invalidate_exact(*keys)` / `invalidate_prefix(prefix)` (SCAN+DEL loop) /
  `is_enabled()`.
- Lazy singleton sync `httpx.Client` (keep-alive, 1 s/1 s timeouts);
  `UPSTASH_REDIS_REST_URL` (+ `UPSTASH_REDIS_REST_TOKEN`) from env,
  both optional — unset URL ⇒ NullCache (same interface, all miss).
- Upstash REST shapes (pinned by a dev-probe acceptance before router
  wiring): `GET {url}/get/{key}` → `{"result": str|null}`;
  `POST {url}` `["SET", k, v, "EX", ttl]` → `{"result":"OK"}`;
  `["SCAN","0","MATCH",pat,"COUNT","100"]` → `{"result":[cursor,[keys]]}`;
  `["DEL", k…]` → `{"result":n}`. Anything unexpected (non-200,
  `{"error":…}`, shape drift) ⇒ MISS/OFF, one warn line with category
  only — never bodies, keys, or tokens in logs.
- `Authorization: Bearer <token>`; strip trailing `/` from URL once.
- Router integration: thin `cached(key_fn, ttl, build)` wrapper called
  inside the five GET handlers — handler builds the dict exactly as
  today on miss, then populates. Write paths call invalidate helpers
  post-commit. `get_db`/models/schemas untouched.
- `config.py`: read the two vars (optional — `validate_startup` must
  NOT hard-require them); `.env.example` documents names only.

## 9. Observability

- Extend `timing.py` stats with `cache` outcome per request
  (`HIT`/`MISS`/`OFF`/`SKIP`) → log field `cache=` + `X-Cache`
  response header. Additive to the existing format (substring tests
  keep passing). Hit-rate sampling from logs replaces guessing.
- Upstash console for command volume/latency/bandwidth (bill watch:
  values are KBs; the 1 MB guard caps the worst case).

## 10. Testing (`backend/tests/test_cache.py`, hand-rolled FakeRedis)

No new test deps: a ~20-line fake implementing
`get/setex/delete/scan` (+ error-injection flag) stands in for
Upstash; SQLite parity suite runs with no URL (NullCache).

- Hit body == miss body (sequential GETs; second carries `X-Cache: HIT`).
- Invalidation per §5 row (seed → mutate → GET is MISS with new data;
  cover append, patch, delete, truncate, profile PATCH, demo PUT,
  account delete).
- Per-user isolation: A's cached list never serves B (distinct users
  via override factory).
- Fail-open: fake raising on every op ⇒ 200s from DB, `X-Cache: OFF`.
- Oversize guard unit test; TTL passed to SETEX asserted on the fake.
- Key hygiene: raw `q` text absent from keys; user id present.
- 404s never cached (unknown code twice ⇒ MISS both times).
- Full suite stays green (107 + new).

## 11. Rollout

1. Merge dark (no URL set ⇒ NullCache; suite green; zero behavior delta).
2. Dev: set the two vars in `backend/.env` (never commit), live-probe
   REST shapes, exercise app, confirm `cache=HIT` lines + faster legs.
3. Prod: set vars on the host; watch hit rate + Upstash bandwidth.
Rollback at any stage: unset the vars (or Redis outage — same code
path). No migration: Redis holds no durable state; `v1` bump
invalidates by rename.

## 12. Proof metrics (done = all true)

- The three §1 legs faster on hits. Calibrated expectation (review
  finding): a hit still pays the `get_current_user` user-upsert
  statement — FastAPI resolves dependencies before the route body, so
  the cache skips COUNT/page/profile selects but never the identity
  RTT (≈1 Neon statement). Expect ~2–4× on lists, not "1 Upstash RTT".
- Hit rate > 50 % on K1/K2 over a normal session (log sample).
- Parallel fan-out p95 down (the queueing win from §1).
- Zero 5xx delta; cached-body == fresh-body test green.
- Full backend + frontend suites green.

## 13. Ops notes

- Upstash console → database → region should sit near the users and
  the backend (Mumbai if offered; verify on the dashboard — if the
  created DB landed in the US, REST RTT ≈ Neon RTT and half the win
  evaporates; move it before prod).
- `backend/.env` additions (values from the Upstash Connect panel):
  `UPSTASH_REDIS_REST_URL=https://…upstash.io`,
  `UPSTASH_REDIS_REST_TOKEN=…`. Names only in `.env.example`.
- All keys carry TTLs, so eviction policy is non-critical; data-class
  JSON in Redis has the same sensitivity as Neon (TLS in transit,
  encrypted at rest on Upstash).

## 14. Explicitly out (reaffirmed)

`GET /auth/me` (identity bootstrap), export (T22 "always current"),
health/ready (liveness), every mutation response, non-200s,
`chat-sync.ts` (frontend no-cache contract holds), any frontend diff
at all, write-behind persistence, stampede singleflight (D10).
