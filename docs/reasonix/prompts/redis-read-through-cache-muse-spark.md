# Redis read-through cache (session prompt — muse-spark-1.3-medium)

```text
You are Muse Spark 1.3, running on medium reasoning, implementing
docs/reasonix/plans/redis-read-through-cache-plan.md (T0 → T7).
Context: docs/reasonix/specs/redis-read-through-cache.md (Status:
Proposed — FROZEN; defects become reports, never unilateral spec edits).
Repo root: C:\Anubhav\Web Dev Projects\PESDac. Workdir for ALL backend
commands: backend/ (plain `python`, no venv, no wrapper).

SKILLS TO USE: using-agent-skills, planning-and-task-breakdown,
test-driven-development, incremental-implementation,
security-and-hardening (per-user key scoping is a wrong-user-leak
boundary — non-negotiable), observability-and-instrumentation (timing
cache= field + X-Cache header), source-driven-development (Upstash REST
shapes from official docs + the Task 0 live probe, never memory),
debugging-and-error-recovery, doubt-driven-development (adversarial
stale-data review before each checkpoint, in the caching-audit tradition).

READ FIRST (open before editing):
- backend/app/routers/chats.py:151-170 (list), :274-355 (append),
  :358-376 (list messages), :379-419 (truncate), :221-271
  (patch/delete/clear), :147-148 (_get_owned), :127-144 (_out/_msg_out)
- backend/app/routers/profiles.py:25-44, demo_state.py:29-56,
  users.py:65-79 (delete-me wipe)
- backend/app/timing.py (stats/log/headers — additive changes only),
  backend/app/db.py (get_engine wiring precedent),
  backend/app/config.py (optional-var precedent),
  backend/app/auth/betterauth.py:62-70 (shared-httpx-client precedent)
- backend/tests/test_timing.py (style guide: TestClient + SQLite,
  state-based assertions, DAMP cases — imitate, don't import)

OWNERSHIP (exclusive — touch nothing else):
- OWN: backend/app/cache.py (new), backend/app/config.py (2 optional
  vars), backend/app/timing.py (additive only), backend/app/routers/
  chats.py + profiles.py + demo_state.py + users.py (listed ranges),
  backend/tests/test_cache*.py (new), backend/.env.example (names only).
- FORBIDDEN: frontend/ in full (chat-sync.ts no-cache contract holds),
  lib/db (drizzle), backend/alembic (no migrations), backend/.env
  (values — human-owned), get_db/models/schemas logic, existing test
  files (additive asserts only), theme/CSS, anything else.
- Do not create branches, commit, push, reset, or touch other runs'
  files. `git status` must show ONLY owned files at every checkpoint.

PREREQ (human-owned): UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
in backend/.env. Verify presence by behavior (is_enabled), NEVER print
or log values. If absent: Task 0 stops and asks; Tasks 1–6 still fully
proceed (NullCache + FakeRedis cover everything dark).

TASKS (plan order; TDD each — RED test → fails → minimal GREEN → next
slice; suite green between slices; one thing per slice):
- T0: live-prove Upstash REST shapes with a temp-dir throwaway script
  (SET→OK, GET hit/miss, SCAN+MATCH, DEL, bad-token fail-closed). Zero
  repo writes. Drift vs spec §8 → update the spec FIRST, then proceed.
- T1: the 2 vars optional (validate_startup must NOT require them).
- T2: cache.py (NullCache, UpstashRestCache lazy singleton sync httpx,
  1 s connect / 1 s read, no retry, JSON assert, CACHE_MAX_BYTES guard,
  outcomes HIT/MISS/OFF/SKIP, §6 key schema) + test_cache.py.
- T3: timing cache= log field + X-Cache header (additive).
- T4: GET /chats K1 (TTL 30 s) + create/patch/delete/clear invalidations.
- T5: GET messages K2 (TTL 60 s) + append/truncate/delete/clear
  invalidations; 404s never cached; keyed-replay duplicate-free.
- T6: profile K3 (60 s) + demos K4 (120 s) + single-key DELs +
  whole-prefix wipe on DELETE /users/me. /auth/me, export,
  health/ready: provably untouched (no cache code paths).
- T7: rollback drill (unset vars → all OFF, suite green); fill spec §12
  with real measured numbers.
STOP after each phase checkpoint and report; proceed only on human go.
If blocked, report the exact blocker + smallest safe options (never
improvise around a red suite or an envelope diff).

DONE GATE (ALL must hold, else NOT DONE — keep working, never report
success early):
- `python -m pytest -q` (workdir backend/) → 0 failed, 0 errors, no
  tracebacks in output, no new warnings vs base (107 + ~25 new).
- Hit body == miss body per cached endpoint; §5 invalidation matrix
  proven per mutation; per-user isolation proven (A's keys never serve
  B); fail-open proven (raising fake → 200s from DB, X-Cache OFF).
- Live dev check (URL set): re-reads log cache=HIT, post-write reads
  MISS-then-fresh; the three spec-§1 legs faster on hits.
- `git status` shows ONLY owned files; `git diff --check` clean; no
  secrets anywhere in diff, logs, or tests.

REPORT BACK exactly: Implemented / Skills activated / Verification
(exact commands + results + before/after timings) / Security notes
(key scoping, log hygiene) / Remaining risks / READY or NOT READY.
```
