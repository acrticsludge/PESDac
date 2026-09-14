# Plan: Upstash REST read-through cache — spec `redis-read-through-cache.md`

## Source of truth

`docs/reasonix/specs/redis-read-through-cache.md` (Status: Proposed).
What it mandates: Upstash **REST** over existing `httpx` (no new deps),
envelope caching on 4 GETs, per-user keys, router-owned write-through
invalidation, fail-open everywhere, zero frontend diff.

## Stack / commands (discovered — use exactly these)

- Backend: Python 3.12+ (3.14 in use), FastAPI + sync SQLAlchemy 2.x,
  pytest 9. No venv, no wrapper — plain `python`.
- Focused tests: `cd backend && python -m pytest tests/test_cache.py`
- Full suite: `cd backend && python -m pytest` (107 tests, must stay green).
- Battle log: `backend/app/timing.py` — every request already logs
  `total_ms / db_ms / db_queries`; extend, don't replace.
- **Do NOT commit.** Leave all changes uncommitted for human review
  (overrides any skill default about committing per increment).

## Phase 0 — risk-first probe (no app code)

### Task 0: live-prove the Upstash REST shapes (XS, 0 repo files)

**Description:** The whole implementation bets §8's recalled REST
shapes (`GET /get/k`, `POST ["SET",…]`, `SCAN`, `DEL`, Bearer auth).
Prove them against the real dev DB with a throwaway script in the OS
temp dir (never in the repo) before writing any app code.

**Acceptance criteria:**
- [ ] Script reads `UPSTASH_REDIS_REST_URL`/`TOKEN` from env only
  (human puts them in `backend/.env` first; values never printed,
  logged, or pasted anywhere).
- [ ] Asserts: SET→`"OK"`, GET hit returns the exact string, GET miss
  returns null result, SCAN+MATCH finds the key, DEL removes it,
  wrong-token call fails closed (proves fail-open path exists).
- [ ] Any shape drift vs spec §8 is written back into the spec
  BEFORE Phase 1 starts.

**Verification:** script exits 0; spec §8 updated if drift found.
**Dependencies:** None (needs human-set env vars; stop and ask if absent).
**Files likely touched:** none in repo.
**Estimated scope:** XS.

### Checkpoint: probe green → REST contract proven, else stop.

## Phase 1 — foundation (dark: no behavior change)

### Task 1: config + `.env.example` (S, 2 files)

**Description:** Read the two optional vars in `config.py`
(`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`); `validate_startup`
must NOT require them. Document names only in `.env.example`.

**Acceptance criteria:**
- [ ] Vars readable via `config`, `None` when unset.
- [ ] Full suite green with vars unset (NullCache path by default).

**Verification:** focused: existing config/pool tests; full suite.
**Dependencies:** Task 0.
**Files likely touched:** `backend/app/config.py`, `backend/.env.example`.
**Estimated scope:** S.

### Task 2: `app/cache.py` + FakeRedis contract tests (M, 2 files)

**Description:** New module: `NullCache` (same interface, all-miss),
`UpstashRestCache` (lazy singleton sync `httpx.Client`, keep-alive,
1 s connect / 1 s read, no retry), `get_json`/`set_json` (JSON assert
+ `CACHE_MAX_BYTES = 1_000_000` skip), `invalidate_exact` /
`invalidate_prefix` (SCAN+DEL loop), key builders per spec §6
(`pesdac:v1:{u:uuid}:…`, sha1-hashed list filters), outcomes
`HIT/MISS/OFF/SKIP`. Hand-rolled FakeRedis in tests (no new test deps).

**Acceptance criteria:**
- [ ] Hit returns the exact stored envelope; miss/expired returns MISS.
- [ ] TTL passed through to SETEX (asserted on the fake).
- [ ] Prefix invalidation deletes only the scoped keys.
- [ ] Any transport error / timeout / bad payload ⇒ OFF, callers
  unaffected (fail-open proven, not just asserted).
- [ ] Oversize envelope skipped, still servable from DB.
- [ ] Raw search text absent from keys; user id present in every key.
- [ ] No router imports this yet — full suite green, zero behavior delta.

**Verification:** `python -m pytest tests/test_cache.py` (new, green);
full suite green.
**Dependencies:** Task 1.
**Files likely touched:** `backend/app/cache.py` (new),
`backend/tests/test_cache.py` (new).
**Estimated scope:** M.

### Task 3: timing extension — `cache=` field + `X-Cache` (S, 2 files)

**Description:** Extend `timing.py` stats with the per-request cache
outcome; log `cache=HIT/MISS/OFF/SKIP` and set the `X-Cache` header.
Additive only — existing `test_timing.py` substring assertions must
keep passing unmodified.

**Acceptance criteria:**
- [ ] Every response carries `X-Cache`; every timing line carries `cache=`.
- [ ] `tests/test_timing.py` green without edits.

**Verification:** focused timing tests + full suite.
**Dependencies:** Task 2.
**Files likely touched:** `backend/app/timing.py`,
`backend/tests/test_timing.py` (additive asserts only).
**Estimated scope:** S.

### Checkpoint: foundation
- [ ] Full suite green; no router behavior changed (`git status` shows
  only `cache.py`, `config.py`, `.env.example`, `test_cache.py`,
  `timing.py` + its test).
- [ ] Human review before wiring reads.

## Phase 2 — reads, one endpoint group per task

Rule for all three: cache ONLY plain-dict 200s (never `JSONResponse`
branches — 404s/conflict-200s/429s execute live); invalidate
post-commit in the same request; TDD each (RED test → GREEN wiring).

### Task 4: chat lists K1 (M, 2 files)

**Description:** Read-through on `GET /chats` (all filter variants,
TTL 30 s); invalidate K1 `*` in create/patch/delete/clear
(`routers/chats.py`).

**Acceptance criteria:**
- [ ] Second identical list call ⇒ `X-Cache: HIT`, byte-identical body.
- [ ] Distinct filter combos key independently; `q` case variants share.
- [ ] Create/patch/archive/delete/clear each turn the next list read
  into a MISS with fresh data (contract test per mutation).
- [ ] Full suite green.

**Verification:** `python -m pytest tests/test_cache_chats.py` + full suite.
**Dependencies:** Task 3.
**Files likely touched:** `backend/app/routers/chats.py`,
`backend/tests/test_cache_chats.py` (new).
**Estimated scope:** M.

### Task 5: message windows K2 (M, 2 files)

**Description:** Read-through on `GET /chats/{code}/messages`
(limit/offset in key, TTL 60 s); invalidate K2 `{code}:*` + K1 `*` on
append/truncate/delete/clear.

**Acceptance criteria:**
- [ ] Window re-read ⇒ HIT, identical envelope incl. `pagination.total`.
- [ ] Append then re-read ⇒ MISS with the new turn present and
  `msgCount`/`lastSeq` advanced (list keys also busted — assert one).
- [ ] Unknown code 404s twice ⇒ MISS both times (never cached).
- [ ] Keyed-replay append (conflict-200) stays duplicate-free.
- [ ] Full suite green.

**Verification:** `python -m pytest tests/test_cache_messages.py` + full.
**Dependencies:** Task 4 (same file, sequential to avoid merge pain).
**Files likely touched:** `backend/app/routers/chats.py`,
`backend/tests/test_cache_messages.py` (new).
**Estimated scope:** M.

### Task 6: profile K3 + demos K4 + account wipe (M, 4 files)

**Description:** Read-through on `GET /profiles/me` (TTL 60 s) and
`GET /demo-state` (TTL 120 s); single-key DEL on PATCH profile /
PUT demo; whole-prefix wipe on `DELETE /users/me`.

**Acceptance criteria:**
- [ ] Profile re-read ⇒ HIT; PATCH ⇒ next read MISS with merged row.
- [ ] First-ever profile read provisions the row through the miss path.
- [ ] Demo PUT ⇒ next list MISS with the override.
- [ ] Account delete ⇒ all user keys gone (prefix wipe proven on fake).
- [ ] `/auth/me`, export, health/ready untouched (no cache code paths).
- [ ] Full suite green.

**Verification:** `python -m pytest tests/test_cache_profile.py` + full.
**Dependencies:** Task 5.
**Files likely touched:** `backend/app/routers/profiles.py`,
`backend/app/routers/demo_state.py`, `backend/app/routers/users.py`,
`backend/tests/test_cache_profile.py` (new).
**Estimated scope:** M.

### Checkpoint: reads
- [ ] Full suite green (107 + ~25 new).
- [ ] Live dev check with URL set: exercise app, confirm `cache=HIT`
  lines on re-reads and MISS-after-write everywhere in §5's matrix.
- [ ] Human review before rollout task.

## Phase 3 — rollout + proof (S)

### Task 7: docs, env template, proof metrics (S, 2 files)

**Description:** `.env.example` already named the vars (Task 1) —
verify wording; flip spec Status to Implemented with the measured
before/after table (§12: the three §1 legs, hit rate from a dev
session sample, fan-out p95 note, 5xx delta).

**Acceptance criteria:**
- [ ] Spec §12 filled with real numbers, not projections.
- [ ] Rollback verified once: unset vars ⇒ all `X-Cache: OFF`, suite green.

**Verification:** full suite; manual log sample.
**Dependencies:** Task 6 + human-set dev URL.
**Files likely touched:** `backend/.env.example`,
`docs/reasonix/specs/redis-read-through-cache.md`.
**Estimated scope:** S.

### Checkpoint: complete
- [ ] All spec §12 metrics true; no frontend diff (`git status`
  shows `backend/` + the two docs only); changes uncommitted.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Recalled Upstash REST shapes drift | Med — wrong client | Task 0 proves shapes pre-code; spec updated first |
| Stale-after-write interleaving (§5 note) | Low — ≤60 s, single-writer typical | Accepted residual with revisit trigger; TTL-bounded |
| Upstash DB in a far region | High — halves the win | Ops check in spec §13 before prod; move DB if misplaced |
| Secret leak via logs/tests | High | Token never logged/printed; FakeRedis in tests; `.env.example` names only |
| Scope creep into Phase 2 (rate-limit/JWKS share) | Med | Explicit non-goal; separate spec when multi-worker lands |

## Open questions

- Upstash DB region (human checks dashboard; spec §13).
- TTL tuning after real hit-rate data (Task 7).

## Parallelization

Tasks 4–6 share `routers/chats.py` — run sequentially. After Task 2,
test files for 4/5/6 could be drafted in parallel against the frozen
`cache.py` contract, then wired sequentially. Default: sequential.
