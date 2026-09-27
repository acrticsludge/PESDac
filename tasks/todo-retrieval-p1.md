# Todo: Retrieval Phase 1 (backend-only)

Source: `tasks/plan-retrieval-p1.md` (spec: `docs/reasonix/specs/retrieval-phase1.md`).
Commands run from `backend/` unless noted. Branch: `feat/retrieval-p1-backend`.

## Phase 0 — Isolation + schema
- [x] T1 — `test_cache_isolation.py` RED→GREEN (`app/cache.py` namespace helpers)
- [x] T2 — migration `0012` + portable models + chain pin → `0012`
- [x] Checkpoint: focused suites green, secret scan clean, no frontend files in `git status`

## Phase 1 — C2 ChunkStore
- [x] T3 — store/search/slice, SQLite path
- [x] T4 — Postgres dialect path (compile-asserted, no live DB)
- [x] Checkpoint: FULL backend suite green (slow), secret scan clean

## Phase 2 — C1 Embedder
- [x] T5 — protocol + hash provider + cache + dims guard
- [x] T6 — workers-ai + nvidia + local (MockTransport; no secret values in tests)
- [x] Checkpoint: focused suites green, `.env.example` names only

## Phase 3 — C3 Manifest + ingest
- [x] T7 — pure `parse_manifest` (also serves validate leg)
- [x] T8 — manifest POST (auth/curator/rate/embed/upsert/events/wipe)
- [x] T9 — validate POST (same verdicts, zero writes)
- [x] Checkpoint: ingest contract suite green, secret scan clean

## Phase 4 — C4 Bundle + search
- [x] T10 — Bundle module + golden ranks (hash provider)
- [x] T11 — search POST + health GET (502/503/429/empty/mismatch paths)
- [x] T12 — X-Request-ID middleware
- [x] Checkpoint: FULL suite green, secret scan clean, backend-only diff

## Phase 5 — Scripts + runbook
- [x] T13 — `scripts/enrich.py` (pacing + checkpoint; validity via T7)
- [x] T14 — `scripts/r2_sync.py` + `scripts/reindex.py`
- [x] T15 — `docs/operations/retrieval.md`
- [x] Checkpoint: complete — spec §9 ticked, ready for human review, no merge yet

## Standing rules (every task)
- RED first (must fail), GREEN minimal, REFACTOR only while green
- Focused: `python -m pytest tests/test_<name>.py -q` · Full: `python -m pytest -q`
- `git diff --check` before every commit; secret scan at every checkpoint
- State, not interactions · DAMP tests · real impls over mocks
- Zero new runtime deps · zero sleeps in new tests · no frontend files
