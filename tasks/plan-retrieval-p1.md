# Implementation Plan: Retrieval Phase 1 (backend-only)

## Overview

Build the retrieval pipeline from `docs/reasonix/specs/retrieval-phase1.md`
(§1–§14) on branch `feat/retrieval-p1-backend`: curator ingest
(manifest POST + validate POST) and evidence search (search POST +
health GET) over Neon pgvector, no LLM calls, no frontend changes.
Build sequence follows the Jev-audited order C2 → C1 → C3 → C4 → C6 →
C5 (spec §10): data plane first, presentation last. Every task is
TDD RED→GREEN→REFACTOR and leaves the suite green.

## Architecture Decisions

- **ChunkStore before everything**: silent-corruption modes (dual-column
  drift, dialect skew) outrank all loud failures — Jev Choice 0.72.
- **No learned rerank in P1**: RRF+MMR with a Jev-compatible
  `build_bundle` seam; TypeSafe stays a reserved env key P1 code never
  reads.
- **SQLite-compatible models, PG-only vector DDL**: `conftest.py` never
  runs migrations; `vector(1024)`/HNSW/tsv live in `0012` behind a
  dialect guard.
- **Zero new runtime deps**: boto3/sentence-transformers stay
  script-lazy; `pyproject.toml` untouched.
- **Tests prove behavior, not internals** (state, not interactions;
  DAMP; real impls > fakes; `httpx.MockTransport` at the HTTP seam).

## Task List

### Phase 0: Isolation tests + schema (C6-cheap + C2-data)

- [ ] **T1 — cache namespace helpers + isolation tests (S)**
  RED: `tests/test_cache_isolation.py` importing `key_for`/`invalidate`
  helpers that don't exist. GREEN: minimal namespace helpers in
  `app/cache.py` (user/infra/shared namespaces); tests pin
  account-wipe-preserves-corpus, ingest-wipe-preserves-rate-keys,
  NullCache fail-open.
  Verify: `python -m pytest tests/test_cache_isolation.py -q` (from `backend/`).
  Deps: none. Files: `app/cache.py`, `tests/test_cache_isolation.py`.

- [ ] **T2 — migration 0012 + portable models (M)**
  RED: `tests/test_migration_chain.py` (head pin → `0012`) fails;
  model import fails. GREEN: `app/models/retrieval.py`
  (RetrievalSource/Chunk/IngestEvent, JSON-only), `alembic/versions/
  0012_retrieval.py` (tables + PG-guarded `embedding_v`/HNSW/tsv +
  downgrade), chain pin bump. SQLite `create_all` must pass untouched.
  Verify: chain test + `test_openapi_routes.py` green; `git diff --check`.
  Deps: T1. Files: 4 listed above.

### Checkpoint: Foundation
- [ ] Focused suites green; `python scripts/check_secrets.py` clean
  (run from repo root); no frontend files touched (`git status`).

### Phase 1: C2 ChunkStore

- [ ] **T3 — store/search/slice on SQLite path (M)**
  RED: golden-free contract tests calling `ChunkStore.store_chunks /
  search_chunks / provider_slice` (brute-force cosine + LIKE).
  GREEN: `app/retrieval/chunkstore.py` with in-memory/SQLite adapter;
  read-back equality of both embedding columns asserted where the
  dialect allows. DAMP cases, one behavior per test.
  Verify: `python -m pytest tests/test_chunkstore.py -q`. Deps: T2.

- [ ] **T4 — Postgres dialect path, no live DB (S)**
  RED: tests compiling search SQL against the `postgresql` dialect
  expecting `<=>`, FTS predicate, pre-pushed filters, DISTINCT
  space-check. GREEN: dialect branch in ChunkStore (compile-asserted,
  never executed in suite). REFACTOR: collapse duplicated filter
  builders.
  Verify: focused suite green. Deps: T3.

### Checkpoint: Data plane
- [ ] Full backend suite green (slow, ~10 min — run once per phase,
  not per task); secret scan clean.

### Phase 2: C1 Embedder

- [ ] **T5 — protocol + hash provider + cache + dims guard (S)**
  RED: `embed_texts` tests (batching, SHA1 cache hit, 1024-d
  rejection). GREEN: `app/retrieval/embeddings.py` skeleton with
  `HashProvider` (deterministic; also powers T3/T10 fixtures).
  Verify: focused suite green. Deps: T2.

- [ ] **T6 — workers-ai + nvidia + local providers (M)**
  RED: per-provider tests over `httpx.MockTransport` (real client
  code, fake transport): batch ≤32, 10 s timeout, 502 on 5xx/timeout,
  503 on missing creds, non-bge-m3 model id refused at selection.
  GREEN: providers + selection (explicit, NO chain) + local lazy
  import (`BAAI/bge-m3` exact). REFACTOR: shared request/response
  plumbing.
  Verify: focused suite green; no secret values in tests (hash-key
  fixtures only). Deps: T5.

### Checkpoint: Embeddings
- [ ] Focused suites green; `.env.example` gains optional names only.

### Phase 3: C3 Manifest + ingest route

- [ ] **T7 — pure Manifest module (M)**
  RED: `parse_manifest` tests (caps, normalization, r2_key⇔fields
  equality, URL origin+prefix trust, version gate, chunk-indexed
  error messages for F1 inline display). GREEN: pure functions, no
  DB/HTTP — also serves the validate leg for free.
  Verify: focused suite green. Deps: none (parallelizable with T5/T6
  once T2 lands).

- [ ] **T8 — manifest POST route (M)**
  RED: contract tests (401 envelope; non-curator → 403 `CURATOR_ONLY`
  with curator + non-curator fixtures; 422s; 200-chunk cap;
  idempotent re-POST; all-or-nothing on embed failure; events row;
  cache wipe). GREEN: `app/routers/ingest.py` wiring Manifest +
  ChunkStore + Embedder; `main.py` registration.
  Verify: `tests/test_ingest_contract.py` green. Deps: T4, T6, T7.

- [ ] **T9 — validate POST route (S)**
  RED: identical verdicts to T8 without writes (DB row counts
  unchanged). GREEN: thin wrapper over T7. Deps: T7, T8.

### Checkpoint: Ingest
- [ ] Ingest contract + golden-adjacent suites green; secret scan clean.

### Phase 4: C4 Bundle + search route

- [ ] **T10 — Bundle module + golden ranks (M)**
  RED: `tests/test_retrieval_golden.py` (fixture corpus + expected
  chunk IDs via deterministic hash provider; MMR kind-diversity case;
  24k-char cap with whole-chunk drops; video shaping). GREEN:
  `app/retrieval/rrf.py` (`RRF_K` env, MMR over source/page/kind,
  `build_bundle` shaped for future per-pair judgments, fail-open to
  RRF). REFACTOR only after green.
  Verify: focused suite green. Deps: T3.

- [ ] **T11 — search POST + health GET (M)**
  RED: contract tests (401/422/429-shape; empty corpus → empty data;
  mixed stamps → 503 `EMBED_SPACE_MISMATCH`; roundtrip re-stamp →
  200; health shape + 60 s counts). GREEN: `app/routers/retrieval.py`
  (gate → cache → embed → space-check → ChunkStore → Bundle).
  Verify: `tests/test_retrieval_contract.py` green. Deps: T4, T6, T10.

- [ ] **T12 — X-Request-ID middleware (XS)**
  RED: header absent on API responses. GREEN: timing-middleware
  addition + log correlation. Verify: focused test green. Deps: none.

### Checkpoint: Search
- [ ] Full backend suite green; secret scan clean; `git status` shows
  backend + docs + scripts only.

### Phase 5: Scripts + runbook (no TDD — tooling, not behavior)

- [ ] **T13 — enrich.py**: offline PDF/PNG/text/LaTeX/table/caption/
  Whisper + quota pacing with checkpoint + manifest writer. Tested
  via T7's parser (manifest validity), manual run for quality.
- [ ] **T14 — r2_sync.py** (multipart + checkpoint resume) **+
  reindex.py** (in-place re-embed + re-stamp, batched/resumable;
  hash-provider dry run in tests).
- [ ] **T15 — docs/operations/retrieval.md**: R2 layout, enrich→sync→
  manifest flow, quota math, provider-switch procedure, CONCURRENTLY
  note, backup story (R2 + manifests + recompute), local-model ID.

### Checkpoint: Complete
- [ ] Full suite green; secret scan clean; spec §9 boxes ticked;
  ready for review (no merge until human approves).

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| PG-only paths untestable in SQLite CI | Med | Compile-assert SQL; read-back proof runs where dialect allows; manual Neon check per runbook |
| Full suite ~10 min with sleeps | Low | Focused suites per task; full suite once per checkpoint; zero new sleeps |
| Batch embed timeouts pin pool slots | Med | Embed-before-txn ordering is a T8 acceptance item, not a comment |
| 429 divergence memory-vs-Redis | Low | Shape-tested only; 1%-over-7d criterion governs changes |
| Scope creep into frontend/LLM | Med | Branch rule + §10 file list; any UI need becomes a new spec, not a task edit |

## Open Questions
- None blocking. Watch items (notin'spec §11/§14): prod 429 rate, Neon recall drift check, R2/Workers creds provisioning (curator's machine, never repo).

## Parallelization
- Sequential: T1→T2→(T3→T4)→(T5→T6)→(T7)→T8→T9→(T10)→T11→T12→T13/T14/T15. Migrations and shared helpers first — no parallel agents on app code. T7/T12/T13–T15 are parallelizable once T2 lands (docs + pure modules).
