# Spec: Retrieval Phase 1 — curator ingestion + evidence search (backend-only, no LLM)

Status: Draft — unimplemented. Branch `feat/retrieval-p1-backend`.
Companion audit: backend audit 2026-09-26 (routers/models/cache/rate-limit
conventions). This spec is the build contract for P1; nothing here
touches `frontend/` (MFADS rename already landed on both sides).

## 1. Background and evidence

- Backend is FastAPI, routers under `/api/v1` (`backend/app/main.py:232-238`).
  New routers register the same way:
  `app.include_router(ingest.router, prefix="/api/v1")`.
- Config is fail-fast (`backend/app/config.py:116-150`): every new env
  var in this spec is **optional** — `validate_startup` is untouched, so
  missing retrieval creds degrade (hash/local provider, 503 on
  provider-dependent legs) instead of breaking boot. `.env.example`
  carries names only, never values (`backend/.env.example:1-39` idiom).
- DB is sync SQLAlchemy, pool 5+5 behind the Neon pooler, per-connection
  `statement_timeout = '15s'` (`backend/app/db.py:40-57,92-103`). Every
  retrieval query must be index-backed ANN+FTS — no sequential scans.
- Tests run SQLite via `Base.metadata.create_all` (`backend/tests/
  conftest.py:32-50`), never migrations. Any `vector(1024)` column must
  therefore live in the **migration only**, with the model storing a
  portable JSON embedding; prod reads `embedding_v`, tests read
  `embedding`. Same doctrine as `JsonType = JSON().with_variant(JSONB(),
  "postgresql")` (`backend/app/models/users.py:22`).
- `vector` extension has been enabled since `0001_foundation.py:24`
  with zero vector columns. Migration chain is linear and pinned by
  `backend/tests/test_migration_chain.py:45-51` (head is now
  `0011_rename_math_mfads` after the MFADS rename) — every new
  migration moves the head pin in that test.
- Subjects are fixed at 5, `Math` renamed to `MFADS` /
  `Maths for AI and Data Science` (`backend/app/models/catalog.py:18-26`;
  migration `0011_rename_math_mfads.py`; frontend `src/lib/chat.ts:6`,
  `src/content/threads/math.ts`). `SUBJECT_CODES` validation in
  `backend/app/schemas/chats.py:28-33` and `backend/app/schemas/
  profiles.py:102-112` accepts MFADS automatically — new code must
  validate subjects the same way, never a hardcoded list.
- `Message.content` is Block JSONB capped at 100 KB
  (`backend/app/schemas/chats.py:16,117-122`). Retrieval responses are
  **not** messages, but any bundle later persisted as one must fit —
  hence the bundle token cap in §6.
- Cross-cutting contracts to reuse verbatim: `check_mutation_origin`
  on all POSTs (`backend/app/deps.py:144-191`), `rate_limit.check(key,
  request, max_hits, window_s)` (`backend/app/rate_limit.py:95-102`),
  `error_body(code, message)` envelope (`backend/app/schemas/
  common.py:8-12`), read-through cache with NullCache fallback
  (`backend/app/cache.py:1-18,37-40`), BetterAuth `get_current_user`
  (`backend/app/deps.py:96-130`).
- External capabilities (MCP-verified 2026-09-26): R2 presigned PUT/GET
  via boto3 S3-compat (`endpoint_url=https://<ACCOUNT_ID>.
  r2.cloudflarestorage.com`, `region_name="auto"`, `generate_presigned_
  url('put_object'/'get_object', …)`); Workers AI BGE-M3 REST
  (`POST /accounts/{id}/ai/run/@cf/baai/bge-m3`, body `{"text":[…]}`,
  1024d, free 10k neurons/day, 3000 req/min embeddings); pgvector HNSW
  cosine (`CREATE INDEX … USING hnsw (embedding vector_cosine_ops)`,
  `ORDER BY embedding <=> '[…]'`, `1 - (emb <=> q)` similarity;
  `vector` ≤ 2000 dims, `halfvec` ≤ 4000); NVIDIA `bge-m3` 1024d
  compatible, `nemotron-3-embed-1b` 2048d-native-only (rejected — see D4).

## 2. Goals / non-goals

Goals:

- Curator (you) can upload PDFs/videos to R2, enrich them offline into
  chunks, store chunks in Neon pgvector, and query them back as an
  **evidence bundle** shaped for the existing frontend `Bubble` union
  (`frontend/src/content/threads/types.ts:28-83`) — all for ₹0, no new
  server, no new billable service.
- Every extracted representation links back to original bytes:
  `{page, bbox, thumb_url, page_url, video_start/end}` on every chunk
  (§4). Originals are never overwritten; generated text never replaces
  source evidence.
- Query latency budget: embed + ANN + FTS + RRF + bundle < 600 ms p50
  warm on a small per-subject corpus (excludes any LLM call — there is
  none server-side in P1).

Non-goals (deferred with exit criteria):

- Answer generation / SSE / `planResponse` replacement. Exit: separate
  completions spec once retrieval Recall@5 clears §9 on the 80-Q set.
- ColPali/ColQwen multivector retrieval. Exit: P3 benchmark shows P1
  diagram Recall@5 < 0.5 while rescore ≥ 0.8 at < 800 ms p95 warm.
- Knowledge-graph extraction. Exit: cross-doc slice systematically
  fails in §9.
- Presigned-URL minting endpoint. Exit: curator uploads outgrow manual
  boto3/wrangler flow. P1 trusts curator-supplied `r2_key`s.
- Per-user private corpora. Curator-only; users' attached images are
  temp query context and are **never accepted** by any endpoint here.
  Lifecycle (stated once so the later completions spec inherits it):
  the image lives only in browser memory (`File` handle + object URL
  per the existing `stageFiles` idiom, revoked on send/remove) and is
  sent client→OpenRouter directly with the question — it never lands
  on the backend or R2, not even transiently. The "never proxies
  media bytes" invariant therefore covers the backend in full.
- Frontend changes of any kind (branch rule). The bundle is shaped for
  `ThreadView` bubbles but no frontend code reads it yet.

## 3. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Single R2 bucket `pesdac-media`; layout `subjects/{SUBJECT}/{unit}/` holding source files + `pages/` + `diagrams/` + per-unit `manifest.json` (§5 tree is normative — `kind` is a DB/source attribute, NOT a path level); public custom-domain read; curator-write only | Locked with curator 2026-09-26. Prefix-scales to new units/subjects; no per-subject buckets/quotas to manage |
| D2 | Neon pgvector as the vector store (already enabled); no Vectorize/Qdrant/Upstash Vector | Zero new services/suspensions/bills; HNSW cosine fits. Vectorize billed `((stored+queries)×dims)` and is single-vector-only; Qdrant Free suspends after 1 wk idle / deletes after 4 wks |
| D3 | Embedding dim fixed at **1024** | BGE-M3 native; fits `vector` (≤2000). Locks one HNSW index; provider swaps never change DDL |
| D4 | Single configured provider, NO fallback chain (`workers-ai` \| `nvidia` \| `local` \| `hash`); any provider failure returns a displayable error (§6) | Silent fallbacks hide outages and mix embedding spaces (rank corruption across dims/sources). Fail honest: the UI shows the message, the curator fixes creds/quota |
| D5 | P1 rerank = RRF + MMR in pure Python; no cross-encoder/LLM rerank | Zero hosting/latency/token cost; sufficient until §9 proves otherwise |
| D6 | Backend performs **no LLM calls and stores no LLM keys** for retrieval | Keeps curator cost ₹0; BYOK completions stay client-side (later spec). The retrieval embed credential (CF/NVIDIA) lives in env; when it is missing or dead the API answers a displayable 503/502 (D4), never a silent fallback |
| D7 | Chunks carry originals pointers, never bytes (`r2_key`, `public_url`, `thumb_url`, `page_url`) | Backend never proxies media (egress/CPU/timeouts); R2 zero-egress serves clients directly |
| D8 | SQLite tests use JSON-embedding brute-force cosine; pgvector SQL only on `postgresql` dialect | `conftest.py` never runs migrations; keeps the suite green without Postgres |
| D9 | Per-subject logical sharding (subject WHERE pushed before ANN) + evidence cache | Bounds ANN scan under the 15 s statement guard; repeat student queries skip embed+ANN |
| D10 | Manifest POST is the only write path; no upload endpoint, no scheduler | No job infra exists (purge unwired); curator triggers ingestion explicitly |

## 4. Data model

### 4.1 Tables (`app/models/retrieval.py`, portable columns only)

`retrieval_sources`: `id` UUID PK; `subject TEXT` FK→`subjects.code`
(validated via `SUBJECT_CODES`, never hardcoded); `unit TEXT`
(e.g. `unit-1`); `kind TEXT` (`slides|notes|textbook|video|
diagram-set`); `title TEXT`; `r2_key TEXT` (e.g. `subjects/CN/unit-1/
slides.pdf`); `public_url TEXT` (server-computed, §6.1 step 4);
`page_count INT`; `version INT` default 1 (incremented per re-ingest —
cheap change visibility without chunk versioning); `created_at`,
`updated_at`.

`retrieval_chunks`: `id` UUID PK; `source_id` FK→sources (CASCADE);
`kind TEXT` (`text|equation|table|diagram|page|transcript`); `page INT`
nullable (video/transcript chunks use NULL + timestamps); `bbox JSON`
nullable (`{x,y,width,height}` in PDF points); `text TEXT` (chunk body /
caption / transcript segment); `latex TEXT` nullable (equations only);
`table_md TEXT` nullable (tables only, GitHub-flavored MD preserving
header row); `caption TEXT` nullable (diagrams/pages); `concepts JSON`
list of strings (diagram tags, e.g. `["bridge rectifier","diode"]`).
Server normalizes at ingest (lowercase, trim, dedupe, drop empties) —
no controlled taxonomy in P1 by design (curator vocabulary is small;
typos fragment only until the curator re-ingests corrected tags);
`video_start/video_end DOUBLE PRECISION` nullable (seconds — float
`real` erodes sub-second precision past ~2 h; integer-ms rejected:
fractional seeks must survive `#t=` without conversion); `thumb_url`,
`page_url TEXT` nullable (R2 originals); `embedding JSON` (portable
list[float], 1024d); `embed_provider TEXT` + `embed_model TEXT`
(stamped at write time — see §7; a provider switch is detectable and
re-embeddable, never silent); `created_at`, `updated_at` (re-ingest
visibility without full versioning — P1 keeps delete-then-insert;
history lives in `ingest_events`, §4.2).

### 4.2 Migration `0012_retrieval` (Postgres-only vector parts)
- `CREATE EXTENSION IF NOT EXISTS vector` (idempotent, mirrors 0001).
- `ALTER TABLE retrieval_chunks ADD COLUMN embedding_v vector(1024)`
  guarded by `if bind.dialect.name == "postgresql"` (Alembic
  `op.get_bind()` check; SQLite path no-ops by design).
- `CREATE INDEX chunks_hnsw ON retrieval_chunks USING hnsw
  (embedding_v vector_cosine_ops)` (HNSW needs no training data; builds
  incrementally on inserts, so manifest POSTs never rebuild. Future
  full rebuilds — e.g. changed `m`/`ef_construction` — must use
  `CREATE INDEX CONCURRENTLY` outside Alembic's transactional
  migration; noted for the runbook, not P1.)
- FTS: `ALTER TABLE retrieval_chunks ADD COLUMN tsv tsvector GENERATED
  ALWAYS AS (to_tsvector('english', coalesce(text,'') || ' ' ||
  coalesce(caption,'') || ' ' || coalesce(latex,''))) STORED` + GIN
  index. The regconfig argument MUST be a literal (`'english'`) —
  generated columns require immutable expressions, so per-source
  language config is out of scope for P1 by construction. No trigger
  fallback: Neon is vanilla Postgres, dead complexity removed per
  review.
- Sync invariant: `embedding` and `embedding_v` are written by ONE
  application helper (`persist_chunk_embedding`, §6.1) in the same
  txn — never two writers, never a generated-column cast. A contract
  test asserts read-back equality of both columns on the Postgres
  path, so a future update path that touches one and not the other
  fails loudly instead of silently breaking ANN while FTS keeps
  passing.
- Audit table `ingest_events` (portable columns, no vector types):
  `id` UUID PK; `curator_user_id` FK→users; `source_id` FK→sources
  nullable (NULL = rejected attempt, still logged);
  `client_ingest_key TEXT` unique nullable (idempotency mapping —
  opportunistic GC: each ingest deletes rows older than 30 d, no
  scheduler needed; replays past GC re-execute as new versions);
  `chunk_count INT`; `manifest_sha256 CHAR(64)`; `embed_provider`,
  `embed_model TEXT`; `neurons_estimate INT` (sum of input-token
  estimates — feeds the §8 quota readout); `created_at`. Answers
  "who ingested what, when" and doubles as the re-ingest history
  (§1 soft-delete gap: deliberate single-version store + full event
  log, not chunk versioning).
- Downgrade drops indexes → `embedding_v`/`tsv` → tables, in that
  order. Head pin in `test_migration_chain.py` moves to `0012`.

### 4.3 Chunk-kind contract (preservation rule)

Every chunk MUST carry the fields that let the UI show the original:

| kind | required | optional |
|---|---|---|
| `text` | `text`, `page`, `page_url` | `bbox` |
| `equation` | `latex`, `page`, `bbox`, `page_url` (+ rendered crop `thumb_url`) | `text` (surrounding sentence) |
| `table` | `table_md`, `page`, `page_url` | `bbox`, `thumb_url` (original crop) |
| `diagram` | `caption`, `concepts[]`, `page`, `thumb_url`, `page_url` | `bbox` |
| `page` | `caption`, `text` (OCR), `page`, `page_url` | — |
| `transcript` | `text`, `video_start/end`, source `public_url` | `page` always NULL |

No chunk may reference bytes outside the single R2 bucket. No chunk
stores a user-supplied image — ingest is curator-authenticated and the
request schema has no image-bytes field (§6).

## 5. R2 layout + manifest (locked)

```text
pesdac-media/
  subjects/
    CN/
      unit-1/
        slides.pdf
        notes.pdf
        lecture.mp4
        pages/
          slides-p001.png
          slides-p002.png
        diagrams/
          bridge-rectifier-p042.png
        manifest.json
    MFADS/
      unit-1/
        ...
```

`manifest.json` (per unit, written by `scripts/enrich.py`, read by
curator before POST):

```json
{
  "manifest_version": 1,
  "subject": "CN",
  "unit": "unit-1",
  "source": {
    "kind": "slides",
    "title": "Unit 1 slides",
    "r2_key": "subjects/CN/unit-1/slides.pdf",
    "public_url": "https://media.example/subjects/CN/unit-1/slides.pdf",
    "page_count": 48
  },
  "chunks": [
    {
      "kind": "equation", "page": 42,
      "bbox": {"x": 120, "y": 240, "width": 400, "height": 80},
      "latex": "\\frac{V}{I}=R",
      "text": "Ohm's law as stated on the slide",
      "thumb_url": "https://media.example/subjects/CN/unit-1/pages/slides-p042-eq1.png",
      "page_url": "https://media.example/subjects/CN/unit-1/pages/slides-p042.png"
    }
  ]
}
```

Public base URL comes from env (`R2_PUBLIC_BASE`), never hardcoded;
`r2_key` is the canonical identity, URLs are derivable. The manifest
carries `"manifest_version": 1` — the server rejects unknown majors
(422) so future schema changes fail loudly instead of half-ingesting.
All shared contracts (§6 intro) plus a new one: every API response
carries an `X-Request-ID` header (UUID per request, set in the timing
middleware) for log correlation; 500s keep their existing body `ref`.

## 6. API contracts

All routes: BetterAuth `get_current_user`, envelope errors, pydantic
`extra="forbid"`. GETs need no origin check (deps doctrine); POSTs
require `check_mutation_origin`.

### 6.1 `POST /api/v1/ingest/manifest` (new `app/routers/ingest.py`)

Rate: `rate_limit.check("ingest-manifest", request, 10, 300)` (curator
pace; bulk embeds cost quota). Auth: `get_current_user` PLUS an
explicit curator check — the authenticated user's `auth_user_id`
(primary; stable) or lowercased email (fallback — an email change
silently revokes access, runbook documents this) must appear in
`CURATOR_AUTH_IDS` (comma-separated env, names-only in
`.env.example`). Otherwise 403 `CURATOR_ONLY`
(`"Only curators can add course material."`). Ship-blocking per
review: without it any logged-in student can POST up to 200
chunks/request into the shared corpus, and retrieval has no
per-chunk trust field to distinguish bad ingest at query time.

Request (caps: ≤200 chunks/req, each `text/table_md/caption` ≤8 KB,
`concepts` ≤20 items × 64 chars, URLs http(s) ≤2048 chars):

```json
{
  "source": {"subject": "CN", "unit": "unit-1", "kind": "slides",
             "title": "Unit 1 slides",
             "r2_key": "subjects/CN/unit-1/slides.pdf",
             "public_url": "https://…", "page_count": 48},
  "chunks": [{...§4.3 items, "embedding": [1024 floats] | null}]
}
```

Behavior:

1. Validate `subject ∈ SUBJECT_CODES` (422 `VALIDATION_ERROR`
   otherwise — same copy as chats/profiles validators).
2. Validate `unit` slug `^[a-z0-9-]{1,32}$`. `r2_key` is canonical:
   the server parses `subjects/{subject}/{unit}/…` out of it and
   asserts equality with the separately-POSTed `subject`/`unit`
   (422 on mismatch) — the declared fields are never trusted over the
   key, so a source can't be addressable two inconsistent ways. The
   upsert natural key remains `(subject, unit, kind, r2_key)`.
3. For chunks with `embedding: null`, embed server-side with the
   single configured provider (§7). On provider failure → 502
   `EMBED_UNREACHABLE` with a human message the UI can display
   (`"Couldn't reach the embedding service. Nothing was saved. Try
   again."`), nothing persisted — all-or-nothing per request. No
   fallback provider is ever consulted (D4). Every persisted chunk is
   stamped `embed_provider`/`embed_model` (§4.1) via the single
   `persist_chunk_embedding` writer (§4.2 sync invariant).
4. Reject any 1024-d mismatch (422). Normalize `concepts`
   (lowercase, trim, dedupe, drop empties — §4.1). URL trust rule: the
   manifest's `public_url` is IGNORED — the source URL is recomputed
   server-side as `R2_PUBLIC_BASE + r2_key`; every chunk asset URL
   (`thumb_url`, `page_url`) must share the `R2_PUBLIC_BASE` origin
   AND sit under `subjects/{subject}/{unit}/` (422 otherwise), so a
   manifest can't point the corpus at a malicious domain. Upsert
   source by `(subject, unit, kind, r2_key)` natural key (re-ingest
   replaces chunks: delete-then-insert in one txn, `updated_at`
   refreshed, source `version` incremented), return
   `{source_id, chunk_count}` 201 (200 on idempotent re-POST with same
   `clientIngestKey` — mirrors `clientAdoptKey` doctrine; header field
   `clientIngestKey ≤64 chars`, unique per curator, NULLs never
   conflict).
5. Write the `ingest_events` row (§4.2: curator, source, key,
   manifest SHA256, provider/model, neuron estimate) in the same txn.
   Invalidate evidence-cache prefix for the subject (§8).

### 6.1b `POST /api/v1/ingest/validate` (same router, no embed, no write)

Curator dry-run: identical validators to §6.1 steps 1–2 + 4
(shape/caps/normalization/URL rules, embedding dims where supplied)
with no provider call and no persistence. Returns
`{ok, chunk_count, warnings[]}` (warnings: e.g. empty concepts,
missing bbox on equations). Same auth + curator gate + 10/300 bucket
(cheap, but still curator-gated: validators must not become an oracle
for anonymous probing).

### 6.2 `POST /api/v1/retrieval/search` (new `app/routers/retrieval.py`)

Rate: `rate_limit.check("retrieval-search", request, 60, 60)` (matches
`chats-create`/`messages-append`; one query per user action in P1 —
if a later frontend fans out multi-query turns, revisit the bucket
then, not now. Burst note: the memory limiter is sliding-window and
absorbs short bursts; the Redis path is fixed-window and does not.
Revisit criterion (not vibes): prod 429 rate on this route exceeding
1% of search traffic over any 7 d window → bump the bucket or add a
burst allowance. Until then 60/60 stands — 429s are recoverable via
the specified Retry UX.)

Request:

```json
{"query": "why is my bridge rectifier output clipped?",
 "subject": "CN",
 "scope": ["slides", "textbook", "lectures"],
 "topK": 10}
```

Rules: `query` 1–2000 chars (422 beyond); `subject` required, ∈
`SUBJECT_CODES`; `scope` subset of `{slides,textbook,lectures}`,
default all three (maps to chunk `kind`s: slides→`page|diagram|
equation|table|text` from slide sources; textbook→same from textbook
sources; lectures→`transcript`); `topK` 1–20, default 10.

Behavior:

1. Normalize query (trim, collapse whitespace; cache key over
   `subject|scope|normalized`).
2. Evidence-cache lookup (§8) → HIT returns stored bundle verbatim.
3. Embed query with the single configured provider (§7). On failure
   → 502 `EMBED_UNREACHABLE` (`"Search is temporarily unavailable.
   Try again in a bit."`), no fallback to unranked FTS — honest error
   beats silent quality drop (D4). Missing provider credentials →
   503 `EMBED_MISCONFIGURED` (`"Search isn't configured on this
   server."`, mirrors the LLM 503 doctrine).
4. Space check: one indexed `SELECT DISTINCT embed_provider,
   embed_model …` under the same subject/scope filter, result cached
   60 s per subject+scope (a cached "active provider per slice" flag —
   cheaper than a per-request DISTINCT, still a genuine pre-ANN
   lookup, never a post-fetch filter): if any stored chunk was
   embedded by a different provider/model than the active
   one → 503 `EMBED_SPACE_MISMATCH` (`"Search index needs a refresh.
   Let your instructor know."` — student-safe copy; "curator" is an
   internal role and never appears in student-facing strings).
   This makes a post-ingest provider switch detectable instead of
   silently incomparable. Re-index via `scripts/reindex.py` (§7) or
   delete-then-insert through §6.1, both re-stamp every chunk.
5. Postgres: ANN leg `SELECT … ORDER BY embedding_v <=> :q LIMIT 30`
   with `subject` + scope-kind WHERE pushed **before** ordering;
   FTS leg `WHERE tsv @@ plainto_tsquery(:q)` same filters
   `LIMIT 30`. SQLite/tests: brute-force cosine over `embedding` JSON
   + `LIKE` filter, same limits.
6. Fuse with RRF (`k` from `RRF_K` env, default 60 — standard,
   tunable per corpus without code), `score += 1/(k+rank)` per leg.
   MMR-thin over (source, page, **kind**) features — kind included so
   one page can't fill the bundle with 10 equations. Cap to `topK`,
   then enforce bundle cap: total `text+latex+table_md+caption` ≤
   24000 chars (~24 KB, ≈4× headroom under the 100 KB message cap, so
   no tokenizer dep is needed — chars/4 variance can't bridge that
   margin; drop lowest-ranked whole chunks first, never truncate a
   chunk mid-field).
7. Response 200:

```json
{"data": [{"chunk_id": "uuid", "kind": "diagram", "page": 42,
  "bbox": {"x":100,"y":200,"width":700,"height":500},
  "text": "…", "latex": null, "table_md": null,
  "caption": "…", "concepts": ["bridge rectifier","diode"],
  "thumb_url": "https://…", "page_url": "https://…",
  "video": null, "score": 0.87}],
 "pagination": {"limit": 10, "offset": 0, "total": 10}}
```

Transcript hits carry `"video": {"url": "…lecture.mp4",
"start": 872.0, "end": 907.0}` (client seeks `#t=872` later).
`score` is fused RRF weight (opaque rank signal, not a probability).

### 6.3 `GET /api/v1/retrieval/health`

No auth (mirrors `/health` doctrine — no secrets; counts describe the
public corpus and §8 states the all-subjects-visible assumption, so no
size leak exists in P1): `{ok, provider, dims: 1024, sources: N,
chunks: N, neurons_24h_estimate}`. Counts + rolling neuron sum cached
60 s.

## 7. Embedding providers (`app/retrieval/embeddings.py`)

One provider is active at a time — selected by
`RETRIEVAL_EMBED_PROVIDER`, no fallback chain (D4). Every failure
surfaces as a displayable envelope error (§6.1/§6.2), never a silent
substitution (substituting embedding spaces mid-corpus corrupts rank).

```python
class EmbedProvider(Protocol):
    dims: int = 1024
    def embed(self, texts: list[str]) -> list[list[float]]: ...
```

- `WorkersAiProvider` (`workers-ai`, default): `POST {CF_BASE}/
  accounts/{id}/ai/run/@cf/baai/bge-m3` `{"text": batch}` →
  `result.data[].embedding`. Batch ≤32, timeout 10 s, patterned on
  `llm.py:_validate_openrouter_key` (fast-fail 502, never hang).
  Free: 10k neurons/day, no CC.
- `NvidiaProvider` (`nvidia`): OpenAI-compat `POST {NVIDIA_BASE}/v1/
  embeddings` `{"model": "baai/bge-m3", "input": batch}` →
  `data[].embedding`. Only the `bge-m3` model id is permitted (1024d;
  any other model id is rejected at startup validation — 2048d would
  break D3).
- `LocalProvider` (`local`): lazy `sentence-transformers` import,
  exact model **`BAAI/bge-m3`** — the same weights as prod, so the
  embedding space is identical (that's the point: local is for
  offline dev, not a different space). CPU-OK; fp16/ONNX quantization
  optional for speed, documented in setup. Dims must equal 1024 or
  startup refuses.
- `HashProvider` (`hash`): SHA256-token-bucket deterministic 1024d.
  Selected explicitly for the test suite (no creds, shape-correct
  assertions) — never consulted implicitly.
- Result cache: SHA1(text)-keyed via `cache.py` primitives (a cache,
  not a provider fallback). Unset/wrong creds for the selected
  provider → 503 `EMBED_MISCONFIGURED` at first use; timeouts/5xx →
  502 `EMBED_UNREACHABLE`. Both carry UI-ready copy (§6).
- Switching `RETRIEVAL_EMBED_PROVIDER` after data exists does NOT
  migrate rows: §6.2 step 4 detects the mix via the stamped columns
  and answers 503 until re-indexed. Re-index path:
  `scripts/reindex.py` reads each chunk's text fields, re-embeds with
  the ACTIVE provider, and updates both embedding columns + stamps in
  place (batched, checkpointed, resumable — same pacing rules as
  enrich). Delete-then-insert via §6.1 is the equivalent heavier path.
- Quota pacing (Workers AI 10k neurons/day; one 48-page PDF ≈ 50k
  tokens ≈ 5 days of quota): `scripts/enrich.py` estimates neurons
  up front, processes in daily-budget chunks with a checkpoint file,
  and resumes — enforced backoff in code, not just runbook prose.
  Each ingest records its estimate in `ingest_events`; health (§6.3)
  exposes a cached 24 h rolling sum as `neurons_24h_estimate` so the
  curator sees burn before the 502s arrive.

New optional env (names-only in `.env.example`): `RETRIEVAL_EMBED_
PROVIDER`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `NVIDIA_API_BASE`,
`NVIDIA_API_KEY`, `CF_ENRICH_ACCOUNT_ID`, `CF_ENRICH_API_TOKEN`
(dedicated enrichment credentials — enrich captioning MUST NOT draw
from the live-search Workers AI quota by default; sharing one account
lets a big enrichment run burn the 10k/day budget and knock out
student search until UTC midnight. When the enrich pair is unset,
captioning falls back to the local VLM), `CURATOR_AUTH_IDS`
(comma-separated auth_user_id or email, matched case-insensitively
after strip/lower), `R2_PUBLIC_BASE`,
`RETRIEVAL_TOPK` (default 10), `RETRIEVAL_MAX_CHARS` (default 24000),
`RRF_K` (default 60).
`TYPESAFE_API_KEY` is RESERVED here (names-only in `backend/.env.example`)
for the later rerank phase: backend env only, never frontend, never the
repo — P1 code paths must not read it.
`validate_startup` untouched. Runbook documents the `local`-provider
friction explicitly: local dev needs a real 1024d-capable model (not
habit-reach MiniLM 384d, which the provider refuses by design).

## 8. Caching

- Result cache: `retrieval:v1:{subject}:{scope}:{topK}:{sha1(query)}`
  → bundle JSON, TTL 300 s, max 1 MB (`CACHE_MAX_BYTES` doctrine);
  invalidated by `retrieval_prefix(subject)` wipe on ingest and by TTL.
  topK is IN the key: a bundle built for topK=20 must never serve a
  topK=5 request (truncation direction is safe, the reverse is not —
  hence keyed, not sliced).
- Embed cache: `retrieval:emb:{provider}:{sha1(text)}`, TTL 86400 s.
- Key hygiene: digests only (mirrors `chats_list_key` hashing of raw
  query text); per-user scoping NOT required. Explicit assumption
  (stated, not implicit): every authenticated user may read every
  subject — there are no per-student histories, no subject-level ACLs,
  no personalized ranking, so a cache keyed on
  (query, subject, scope, topK) leaks nothing across users. If
  per-user corpora or restricted subjects ever land, this key schema
  must gain a user scope first.
- All cache legs fail open to DB/compute (NullCache identical).

## 9. Test plan (order matters — first batch first)

- `tests/test_cache_isolation.py` (FIRST, per Jev audit: cheapest
  mitigation of the highest residual silent risk): account/user wipe
  leaves shared corpus keys intact; ingest subject-wipe leaves
  rate-limit + lock keys intact. Fail-open NullCache behavior pinned.
- `tests/test_retrieval_contract.py`: auth required (401 envelope);
  subject/scope/topK validation (422s); empty-corpus search → empty
  `data`; seeded-hash corpus → rank/determinism; bundle caps honored;
  mixed-provider corpus → 503 `EMBED_SPACE_MISMATCH` (seed one chunk
  stamped `other-provider`); user-image-shaped payloads rejected (no
  such field accepted — `extra="forbid"` proof); rate-limit 429 shape
  after 60/60.
- `tests/test_ingest_contract.py`: origin/ auth/ rate gates;
  non-curator identity → 403 `CURATOR_ONLY` (curator + non-curator
  fixtures); subject + `r2_key`-prefix/declared-field mismatch 422s;
  foreign-origin asset URL 422 (trust rule); manifest without
  `manifest_version` / unknown major 422; 200-chunk cap; dim-mismatch
  422; concepts normalization (mixed-case/dupes in, clean list
  stored); idempotent re-POST via `clientIngestKey`; nothing persisted
  on embed failure (all-or-nothing); `embedding`/`embedding_v`
  read-back equality on the Postgres-dialect path (sync invariant
  §4.2); `validate` leg returns identical verdicts without writing.
- `tests/test_retrieval_golden.py` (NEW): fixture corpus + fixed
  query set with expected chunk IDs (hash provider is deterministic,
  so ranks are stable — regression tripwire, not a quality
  benchmark); plus the provider-switch roundtrip (mixed stamps →
  503 → re-stamp via ingest → 200).
- Heavy/slow: keep the repo's full-suite caveat (5–10 min with sleeps);
  new tests add zero sleeps. HNSW-vs-brute-force recall drift is
  measured manually against prod Neon per the runbook (needs
  Postgres; unmeasurable in SQLite CI) before each index-parameter
  change. No k6/load rig in P1 — burst behavior is shape-tested via
  the 429 contract only.
- `tests/test_migration_chain.py`: head pin → `0012_retrieval`.
- Heavy/slow: keep the repo's full-suite caveat (5–10 min with sleeps);
  new tests add zero sleeps. Manual: seed 1 unit via enrich→sync→
  manifest, run the 80-Q methodology (§9 of the audit) once olives are
  in; P1 exit bar — text Recall@5 ≥ 0.8, equation/table ≥ 0.65,
  p50 retrieval < 600 ms warm, curator cost ₹0.

## 10. File change list (this branch, backend-only)

| File | Change |
|---|---|
| `backend/app/models/retrieval.py` | NEW — portable `RetrievalSource/Chunk` + `IngestEvent` |
| `backend/alembic/versions/0012_retrieval.py` | NEW — tables + `ingest_events` + PG-only `embedding_v`/HNSW/FTS + downgrade |
| `backend/app/retrieval/__init__.py` | NEW package |
| `backend/app/retrieval/embeddings.py` | NEW — protocol + 4 providers + result cache (no chain) |
| `backend/app/retrieval/rrf.py` | NEW — RRF+MMR fuse (`RRF_K` env) |
| `backend/app/schemas/retrieval.py` | NEW — manifest/search/health/validate schemas, caps |
| `backend/app/routers/ingest.py` | NEW — manifest POST + validate POST |
| `backend/app/routers/retrieval.py` | NEW — search POST + health GET |
| `backend/app/main.py` | Register both routers (`/api/v1`) |
| `backend/.env.example` | Optional names only (`CURATOR_AUTH_IDS`, `RRF_K`) |
| `backend/scripts/enrich.py` | NEW — offline PDF/PNG/text/LaTeX/table/caption/Whisper + quota pacing w/ checkpoint + manifest writer (lazy heavy imports) |
| `backend/scripts/r2_sync.py` | NEW — local-creds boto3 uploader, multipart + checkpoint resume (keys never enter repo/env-example values) |
| `backend/scripts/reindex.py` | NEW — in-place re-embed with active provider + re-stamp (batched, resumable) |
| `backend/tests/test_cache_isolation.py` | NEW, FIRST — shared-vs-user-vs-infra wipe isolation |
| `backend/tests/test_retrieval_contract.py` | NEW |
| `backend/tests/test_ingest_contract.py` | NEW (403 gate, URL trust, normalization, sync invariant, validate leg) |
| `backend/tests/test_retrieval_golden.py` | NEW — deterministic golden ranks + switch roundtrip |
| `backend/tests/test_migration_chain.py` | Head pin → `0012` |
| `backend/pyproject.toml` | NO new runtime deps (boto3/sentence-transformers stay script-lazy; `typesafe-sdk` deferred to the rerank phase — P1 code makes no Jev calls) |

Build sequence (Jev-audited 2026-09-26, Choice 0.72): C2 ChunkStore
(`store_chunks` / `search_chunks` / `provider_slice`, pgvector adapter
in prod, brute-force adapter in tests) → C1 Embedder → C3 Manifest →
C4 Bundle (RRF now; `build_bundle` interface shaped so per-pair
judgment packs plug in later with fail-open to RRF and zero route
changes) → C6 Namespaces → C5 Contract. Exception to the order: C6's
two wipe-isolation tests (account-delete preserves corpus; ingest-wipe
preserves rate keys) land in the FIRST test batch — cheapest mitigation
of the highest residual silent risk.

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Workers AI 10k neurons/day exhausted mid-backfill | 502s on ingest | Batch + pace backfills; embeds cached by content hash so re-ingests are free; UI shows the 502 copy, curator retries later |
| NVIDIA prototype credits/40 RPM hit | 502s on the `nvidia` setting | UI shows the 502 copy; switch `RETRIEVAL_EMBED_PROVIDER` explicitly if desired — never automatic |
| `tsv GENERATED` unsupported on Neon | Migration failure | Literal-regconfig form per §4.2; Neon is vanilla Postgres. No fallback kept (dead complexity removed per review) |
| `profiles.subjects` arrays with stale `Math` on prod | 422s for old rows | 0011 already migrates; ingest/search re-validate and name the code |
| 60/60 search bucket under future multi-query turns | 429s mid-turn if frontend ever fans out N queries per send | Mental note only: P1 does one query per user action; revisit the bucket when decomposition lands |
| `local`-provider 1024d refusal confusing next dev | Looks like a broken default | Runbook names the exact model (`BAAI/bge-m3`, same space as prod) |
| Bundle exceeds future message 100 KB cap | Persist failure later | 24k-char bundle cap + per-field 8 KB caps now; search never persists |
| SQLite cosine drift vs HNSW recall | Test/prod rank skew | Contract tests assert shape/caps/determinism, never exact ANN order; manual Neon recall check per runbook before index-parameter changes |
| Storage at scale (`vector` 4 KB/chunk) | 400 MB @ 100k chunks | P3: `halfvec` migration halves it; not P1 (pgvector supports both, one ALTER later) |
| Domain synonyms unhandled ("BJT"↔"bipolar junction transistor") | Recall loss on jargon | P2 with exit bar: promote when synonym-class queries systematically miss in §9 runs; BGE-M3 covers the common cases in P1 |
| Query-type routing (factoid vs diagnostic fusion weights) | One-size fusion | P3: needs a classifier + tuning data; RRF-uniform is the honest P1 default |
| Offset pagination degradation at depth | Slow deep pages | Deferred: topK ≤ 20 keeps offsets shallow; cursor `(score,id)` if deep paging ever needed |
| No ETag on search | Repeated identical polls cost bytes | Deferred: evidence cache already absorbs repeats server-side; cheap to add later |

## 12. Open questions (resolved unless noted)

- ~~Curator identity gating~~ RESOLVED: explicit `CURATOR_AUTH_IDS`
  env allowlist checked in-route → 403 `CURATOR_ONLY` (§6.1). Gates
  before build per review.
- ~~Presign endpoint~~ RESOLVED: no presign endpoint in P1 —
  curator uploads via local boto3/wrangler with keys on their machine
  (§6.1). Revisit when curator uploads outgrow manual flow.
- Terminology lock: "Astryx" = the UI kit (`@astryxdesign/core`
  0.5.2, source of `Banner`/`AppShell`); "Astro" = the web framework.
  Not a typo — stated once so the version pin reads correctly.

## 13. Frontend display contract (per feature; implementation deferred)

No frontend code changes in P1 (branch rule) — this section is the
display contract a later frontend pass implements verbatim. All
surfaces use Astryx only (AGENTS.md §2): `Banner` (`status:
info|warning|error|success`, `container: card|section`,
`isDismissable`, `onDismiss`, `dismissLabel`, `endContent`,
collapsible children) and the existing toast/composer-status bridges
(`AppToasts`, `ThreadView` composer `status`, `ChatToolCalls` chips).
No custom HTML/CSS banners, no floating divs, no modals for these
errors.

### 13.1 Surface rules (applies to every feature below)

| Backend outcome | Surface | Why |
|---|---|---|
| 200 with results | Thread bubbles (existing `Markdown`/`Thumbnail`+`Lightbox`/`PdfPreviewBody`/artifact cards) + `ChatToolCalls` settled chips; crops carry `alt` = caption, click opens `Lightbox`, every evidence card links "View full page" (`page_url`) | Normal path; no banner, no toast |
| 200 empty bundle | Assistant message: "Nothing in your course material covers this yet." + action follow-ups ("Try rephrasing", "Search a different source", "Quiz me on what we've covered") — never a dead end, no banner | Empty is content, not failure |
| 422 `VALIDATION_ERROR` | Inline / composer-adjacent copy (or form-field error on the future ingest panel), plus one error toast | User-fixable input problem; app itself is healthy |
| 429 `RATE_LIMITED` | Composer `status` warning + inline Retry (existing `sendError`/`handleRetry` idiom in `ThreadView`); one toast max | Transient; retry is the action, not dismissal |
| 401 | Existing global re-login flow (`AUTH_REQUIRED_EVENT`) | Identity problem, not retrieval — no new UI |
| 502 `EMBED_UNREACHABLE` on search | **Site-wide downtime bar** (§13.2) + composer `status` line naming it | Blocks the core loop (every question needs retrieval) |
| 503 `EMBED_MISCONFIGURED` on search | **Site-wide downtime bar** (§13.2), `warning` until first failure then `error` if persistent | Same blast radius; student-safe copy only ("Search isn't available right now"), never internal roles |
| 502/503 on ingest | **Site-wide downtime bar** (§13.2) on the ingest/admin surface only if one exists; otherwise toast + inline form error (curator-only, P1 has no admin UI — display binds when the panel lands) | Curator flow, not student loop |

### 13.2 Site-wide downtime bar (the "crucial error" pattern)

Used exactly for the rows marked above: search 502/503. Rendered in
the AppShell `banner` slot (vendor landmark above the top nav —
`AppShell.tsx:543,670-672`, doc: "banner slot, for system-wide
announcements"), so it spans the full top like other sites' downtime
bars, above sidebar and thread alike.

```tsx
<Banner
  status="error"            // 502; "warning" for first-seen 503
  container="section"       // full-width bar, no card radius
  title="Search is temporarily unavailable"
  description="Your course material can't be reached right now. Your chats and settings still work — new questions will wait until search is back."
  isDismissable
  dismissLabel="Dismiss search outage notice"
  onDismiss={recordRetrievalBannerDismissal}  // §13.4
  endContent={<Button label="Retry" variant="ghost" onClick={retryLastSearch} />}
/>
```

Rules:

- ONE retrieval banner at a time (newest incident replaces; never
  stack 502 over 503).
- Coexists with unrelated banners (auth expiry, etc.) — no shared
  dismissal state (§13.4 keys per incident class).
- `error` exposes `role="alert"`, `warning` `role="status"` (vendor
  `statusRole` map) — screen readers announce without focus theft;
  focus stays in the composer.
- Copy comes from the envelope `error.message` when present (backend
  copy in §6 is UI-ready by contract); the title strings above are
  the fallback when the body is unreadable (network failure).
- Reduced-motion: no entrance animation dependency — the bar is
  either mounted or not (same doctrine as `ThreadView` B43).

### 13.3 Per-feature display

**F1 — Ingest manifest (curator-only, no student UI).** P1 has no
admin panel, so display binds when one lands: 422s render as inline
field errors on the manifest form (per-chunk index in the message,
e.g. "Chunk 14: latex exceeds 8 KB"); 429 → toast + disabled submit
until `Retry-After`; 502/503 → `error`/`warning` section Banner at
the top of the admin panel (same component, `container="section"`,
dismissible) since a dead embedder blocks the whole curator flow.
Nothing here ever surfaces in student threads.

**F2 — Retrieval search (student loop).** States, in order:
1. *Loading*: existing `ChatToolCalls` running chip (`retrieve —
   course slides`, vendor `status="running"`); composer shows its
   pending affordance. If no first evidence arrives within ~800 ms,
   mount bubble skeleton rows (gray blocks, existing skeleton idiom —
   perceived speed for slow embeds, not a spinner).
2. *Results*: bubbles as in §13.1 + settled duration chips + a
   collapsible `Banner container="card" status="info"` listing
   sources ("Answered from Unit 1 slides p.42, lecture 14:32") —
   default ON (study tool: provenance is the product), honoring the
   profile `citations` setting when the user changes it — never a
   top bar. Video hits render an "Open at 14:32" button (seeks
   `mp4#t=`, tooltip shows the segment text); inline player is a
   named future, not P1.
3. *Empty*: §13.1 assistant message + action pills, no banner, no
   toast.
4. *502/503*: downtime bar (§13.2) + composer `status` line with the
   same copy + the failed turn keeps its Retry (existing error-block
   path — retry replays the search, it does not duplicate the user
   message). Dismissing the bar never clears the composer status;
   resolving the incident clears both. `EMBED_SPACE_MISMATCH` copy
   reads "Search index needs a refresh. Let your instructor know."
5. *429*: composer status + Retry only — deliberately NOT the top
   bar (transient, per-IP, self-resolving; a site-wide bar would
   over-alarm).

**F3 — Retrieval health (ambient status).** Mirrors the existing
`showKeyDot` pattern on the sidebar Settings row (`Pesdac.tsx` LLM
dot): a `StatusDot variant="warning"` appears while
`GET /retrieval/health` reports degraded/unreachable. Tooltip carries
last-check time + provider + a Retry affordance that re-fires the
health read (not a dead label). Clicking lands on Settings (future: a
Search section). The dot is the persistent signal; the top bar is the
incident signal — dot without bar means "flaky, retries working",
bar means "blocked now".

### 13.4 Dismissal + re-show policy

- `onDismiss` writes `{code, dismissedAt}` to localStorage under one
  key (`pesdac:retrieval-banner`, device-local like drafts — never
  server state, never cross-identity: cleared on identity transition
  per the session-store doctrine).
- A dismissed incident class stays hidden until: a *different* code
  arrives (502→503 or reverse), or **1 h** elapses since dismissal
  (quiet window, not 24 h — a dismissed persistent outage must
  resurface; the timer runs from dismissal, and any new failure after
  a success is a new incident regardless), or the next failed search
  for that class occurs after a success (flap = new incident).
- Retry (`endContent`) re-fires the last search; success unmounts the
  bar and clears the stored dismissal. Failure keeps the bar (no
  toast spam — the bar IS the notice).

## 14. Gap disposition (second review pass, 2026-09-26)

Accepted into this spec: `ingest_events` audit log (+ opportunistic
30 d key GC, no scheduler); `CURATOR_AUTH_IDS` prefers stable
`auth_user_id`, email fallback with documented revocation caveat;
server-computed `public_url` + origin+prefix validation on every
asset URL; `POST /ingest/validate` dry-run; `manifest_version: 1`;
`updated_at` + source `version`; `DOUBLE PRECISION` timestamps;
concepts normalization (no P1 taxonomy); MMR over (source, page,
kind); `RRF_K` env (default 60); `scripts/reindex.py`;
`BAAI/bge-m3` named as the local model (same space as prod);
quota pacing with checkpoints in enrich + `neurons_24h_estimate` on
health; `X-Request-ID` on all API responses; golden-rank tests +
switch roundtrip; empty-state action pills; citations default ON;
video "Open at mm:ss" button; crop alt/Lightbox/full-page link;
1 h dismissal quiet window; ~800 ms skeleton; student-safe mismatch
copy; health tooltip with last-check + retry.

Deferred with exit bars: domain-synonym expansion (P2 — promote when
synonym-class queries systematically miss); query-type routing (P3 —
needs classifier + tuning data); `halfvec` (P3 — one ALTER at 100k
chunks); cursor pagination + ETag (no need at topK ≤ 20, cache
absorbs repeats); k6-style load rig (shape-tested 429s suffice).

Rejected with reason: per-chunk soft-delete/versioning (single-version
store + `ingest_events` history is the cheaper correct shape);
`tiktoken` bundle counting (24k chars ≈ 24 KB ≈ 4× under the 100 KB
cap — variance can't bridge it).

Jev audit (live, 2026-09-26, `jev-1.13.0`, 2 calls, ~$0.0001):
selection Choice picked C2 ChunkStore first (0.72, confidence 0.67;
C1 0.22, rest ≈ 0). Silent-risk Nouls all landed in the caution band
(C6 0.74 down to C1 0.61 — relative ordering only; the questions were
leading by design). Spec-risk Nouls: cache-topK cleared (0.13),
r2-trust leaning clear (0.40), curator-gate leaning clear (0.41),
quota-coupling genuinely uncertain (0.47), drift-gap mild concern
(0.58 → build C2, the mitigation), rate-burst highest residual (0.61)
but recoverable via Retry UX — bucket kept at 60/60, no churn without
data. Verdicts applied: build order C2 → C1 → C3 → C4 → C6 → C5, with
C6's wipe-isolation tests pulled forward cheaply (highest residual
risk) ahead of the full namespace module.

Rerun (same 4 Nouls, state updated with the shipped mitigations):
drift 0.58→0.43 (C2-first ordering registered — now leaning clear),
burst 0.61→0.51 (Retry UX + 1% revisit criterion registered —
coin-flip, fixed-window residual remains), quota 0.47→0.47 (stable,
already specified), curator 0.41→0.47 (noise band, still leaning
clear; the email-fallback caveat reads slightly louder in the fuller
state). Nothing remains in the caution band. Single-run Nouls carry
±0.05–0.1 run noise — read deltas as direction, not decimals.
