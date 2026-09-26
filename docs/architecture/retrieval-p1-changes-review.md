# Architecture Review: Retrieval Phase 1 pipeline (backend-only, no LLM)

Audience: an independent reviewer (Claude) asked to critique
correctness, consistency, and risk of the retrieval design. Source of
truth is `docs/reasonix/specs/retrieval-phase1.md` (§1–§13); this
document restates the pipeline end-to-end so it can be reviewed
standalone. Branch: `feat/retrieval-p1-backend`. No implementation
exists yet — review the contract, not code.

## 1. What the pipeline is (one paragraph)

A curator-only ingestion path (R2 upload → offline enrich → manifest
POST → Neon pgvector) plus an evidence-search path (query → embed →
ANN + FTS → RRF fuse → capped bundle shaped for existing frontend
bubbles). The backend performs no LLM calls, stores no LLM keys, and
never proxies media bytes. The LLM step lives in a later frontend
pass: it sends the bundle + user question to the user's own OpenRouter
key client-side.

## 2. End-to-end flow

```text
Curator:  PDF/video ──► R2 (direct upload, local boto3/wrangler)
              │
              ▼  scripts/enrich.py (offline, ephemeral — your machine/Colab)
          page PNGs + text + LaTeX + table MD + captions + transcripts
          + embeddings + manifest.json
              │
              ▼  POST /api/v1/ingest/manifest (auth, 10/300 rate)
          Neon pgvector (sources + chunks, HNSW cosine)
              │
Student:  POST /api/v1/retrieval/search {query, subject, scope, topK}
              │  (auth, 60/60 rate)
              ▼  embed query → ANN top-30 + FTS top-30 → RRF+MMR → bundle ≤ topK
          evidence JSON (pages, equations, diagrams, tables, video timestamps)
              │
              ▼  (later frontend pass) client → OpenRouter SSE with user key
```

## 3. R2 layout (locked)

Single bucket `pesdac-media`, public custom-domain read,
curator-write only:

```text
pesdac-media/
  subjects/
    {SUBJECT}/            # CN | OS | DLCD | DSA | MFADS (validated via SUBJECT_CODES)
      {unit}/             # slug ^[a-z0-9-]{1,32}$  (e.g. unit-1)
        slides.pdf  notes.pdf  lecture.mp4
        pages/            # slides-p001.png … (layout-preserving renders)
        diagrams/         # individual crops
        manifest.json     # per-unit manifest (§4)
```

`r2_key` (`subjects/{subject}/{unit}/…`) is the canonical identity;
public URLs derive from `R2_PUBLIC_BASE` env (never hardcoded).

## 4. Manifest + chunk contract

Per-unit `manifest.json`: `{subject, unit, source:{kind, title,
r2_key, public_url, page_count}, chunks:[…]}`. `source.kind ∈
{slides,notes,textbook,video,diagram-set}`; `chunk.kind ∈
{text,equation,table,diagram,page,transcript}`.

Preservation rule — every chunk links back to original bytes:

| kind | required | purpose |
|---|---|---|
| `text` | `text`, `page`, `page_url` | definitions, explanations |
| `equation` | `latex`, `page`, `bbox`, `page_url` + rendered crop `thumb_url` | exact formulas; LLM explains, source stays canonical |
| `table` | `table_md` (header-preserving MD), `page`, `page_url` | reasoning over MD, display original (+ optional crop) |
| `diagram` | `caption`, `concepts[]`, `page`, `thumb_url`, `page_url` | retrievable via caption/tags, shown as original crop |
| `page` | `caption`, OCR `text`, `page`, `page_url` | slide layout preserved as image |
| `transcript` | `text`, `video_start/end` (s), source `public_url` | timestamp hits seek `mp4#t=` |

No chunk stores user-supplied images — ingest is curator-authenticated
and the schema has no image-bytes field (`extra="forbid"` proof in
tests). `bbox = {x,y,width,height}` in PDF points, nullable where
meaningless (transcripts: `page` NULL + timestamps instead).

## 5. Data model + migration `0012_retrieval`

Portable models (`app/models/retrieval.py`): `retrieval_sources`
(subject FK→`subjects.code`, unit, kind, title, r2_key, public_url,
page_count) + `retrieval_chunks` (source FK CASCADE, kind, page, bbox
JSON, text/latex/table_md/caption, concepts JSON, video_start/end,
thumb/page URLs, `embedding` JSON list[float] 1024d, **`embed_provider`
+ `embed_model` stamped at write** — a provider switch is detectable
and re-embeddable, never silent).

Postgres-only parts live in the migration (SQLite suite never runs
migrations — same doctrine as `JsonType`): `embedding_v vector(1024)`,
`HNSW … vector_cosine_ops` (incremental on inserts; full rebuilds need
`CREATE INDEX CONCURRENTLY` outside Alembic's transactional migration —
runbook note), FTS `tsv tsvector GENERATED … to_tsvector('english', …)`
(regconfig MUST be a literal; no per-source language config in P1) +
GIN, subject/kind indexes. Reversible; chain-pin test moves head to
`0012`. One writer helper persists `embedding` + `embedding_v` in the
same txn (sync invariant, contract-tested). Dim fixed
at 1024 (BGE-M3 native; fits `vector` ≤ 2000; NVIDIA `nemotron-3-embed`
2048d-native explicitly rejected).

## 6. Embedding providers (single, no fallback)

One active provider via `RETRIEVAL_EMBED_PROVIDER`
(`workers-ai` default | `nvidia` | `local` | `hash`), selected
explicitly — failures return displayable envelope errors, never silent
substitution (mixing embedding spaces corrupts rank):

- `workers-ai`: `POST {CF}/accounts/{id}/ai/run/@cf/baai/bge-m3`
  `{"text": batch≤32}`, 10 s timeout, free 10k neurons/day, no CC.
  Enrichment captioning uses SEPARATE `CF_ENRICH_*` credentials (never
  the live-search quota — a shared account lets backfills knock out
  student search till midnight); unset ⇒ local-VLM captions.
- `nvidia`: OpenAI-compat `POST {BASE}/v1/embeddings`
  `{"model":"baai/bge-m3","input":batch}` — only the `bge-m3` model id
  permitted (startup rejects anything else; guards D-dim).
- `local`: lazy `sentence-transformers` (dev/offline; must be 1024d or
  startup refuses).
- `hash`: deterministic SHA256-bucket 1024d — test-suite-only by
  explicit setting, never implicit.

SHA1(text)-keyed result cache (a cache, not a fallback). Missing creds
→ `503 EMBED_MISCONFIGURED` ("Search isn't configured on this
server.", mirrors LLM 503); timeouts/5xx → `502 EMBED_UNREACHABLE`
("Couldn't reach the embedding service…" / "Search is temporarily
unavailable…"). All envelope-shaped with UI-ready copy.

## 7. Endpoint contracts

Shared: BetterAuth `get_current_user`, `check_mutation_origin` on
POSTs, `rate_limit.check`, `error_body` envelope, pydantic
`extra="forbid"`.

**`POST /api/v1/ingest/manifest`** (10/300, PLUS curator gate:
`auth_user_id`/email ∈ `CURATOR_AUTH_IDS` env else 403 `CURATOR_ONLY`
— ship-blocking: any-authenticated would let students poison the
shared corpus, which has no per-chunk trust field): validates subject ∈
`SUBJECT_CODES`, unit slug; `r2_key` is canonical — server parses
`subjects/{subject}/{unit}/…` out of it and 422s on mismatch with
declared fields; caps ≤200 chunks/req, text fields ≤8 KB,
`concepts` ≤20×64 chars, URLs ≤2048 chars; embeds null-embedding
chunks (batched, stamped `embed_provider`/`embed_model`) then upserts
source by natural key `(subject,unit,kind,r2_key)` with
delete-then-insert chunk replace in one txn; idempotent re-POST via
`clientIngestKey` (mirrors `clientAdoptKey`); all-or-nothing (502 ⇒
nothing persisted); invalidates subject evidence-cache prefix. Returns
201 `{source_id, chunk_count}` (200 on keyed replay).

**`POST /api/v1/retrieval/search`** (60/60):
`{query 1–2000 chars, subject required, scope ⊆
{slides,textbook,lectures} default all, topK 1–20 default 10}`.
Scope maps to chunk kinds (slides/textbook → page|diagram|equation|
table|text from those sources; lectures → transcript). Steps: normalize
→ evidence-cache HIT returns verbatim → embed (502/503 honest errors)
→ space check (`DISTINCT embed_provider/embed_model` under filter;
mismatch ⇒ 503 `EMBED_SPACE_MISMATCH`, re-index to fix) → ANN
(`ORDER BY embedding_v <=> :q LIMIT 30`, subject/scope WHERE pushed
before ordering; SQLite: brute-force cosine + LIKE) + FTS
(`tsv @@ plainto_tsquery LIMIT 30`) → RRF(k=60) fuse → MMR diversity
→ cap topK → bundle cap ~24k chars (drop lowest-ranked whole chunks,
never mid-field truncation). Response `{data:[{chunk_id, kind, page,
bbox, text, latex, table_md, caption, concepts, thumb_url, page_url,
video:{url,start,end}|null, score}], pagination}`. Transcript hits
carry seekable timestamps.

**`GET /api/v1/retrieval/health`** (no auth, no secrets):
`{ok, provider, dims:1024, sources, chunks}`, counts cached 60 s.

## 8. Retrieval quality + latency expectations (projections to verify)

Text definitions 0.85–0.95 / tables 0.70–0.85 / equations 0.70–0.85
(depends on LaTeX extraction) / slides-scanned 0.65–0.80 / diagrams
0.60–0.75 (caption proxy, not visual similarity) / circuits 0.50–0.70
(known miss mode: topology with no text match) / video ±10 s 0.75–0.90
/ cross-page-doc 0.55–0.75. Retrieval p50 150–500 ms warm
(embed 40–120 + ANN/FTS 50–200 + RRF <20 + bundle fetch); first token
dominated by the user's later-chosen LLM (1–3 s). Pure ColPali would
gain ~10–15 pts on circuits at 5–10× latency plus GPU hosting —
deferred to a P3 benchmark with promotion bar (diagram Recall@5 <0.5
vs ≥0.8 at <800 ms p95).

## 9. Frontend display contract (no frontend code in P1)

Outcome→surface: 200 results → existing bubbles + settled tool chips;
200 empty → assistant "nothing covers this yet" message (never a
banner); 422 → inline/toast; 429 → composer status + Retry (never top
bar — transient); 401 → global re-login; 502/503 on search →
site-wide `Banner container="section"` in AppShell `banner` slot
(full-top downtime bar, `error`/first-`warning`, dismissible with
Retry action, one-at-a-time, focus stays in composer, envelope copy
verbatim); health → sidebar `StatusDot` mirroring the key-dot pattern.
Dismissal device-local per incident class; re-show on new code / 24 h /
flap-after-success. Verified against installed Astryx 0.5.2
`BannerProps`.

## 10. File change list (planned, backend-only + spec + scripts)

`app/models/retrieval.py`, `alembic 0012` (incl. `ingest_events`
audit log + 30 d opportunistic key GC), `app/retrieval/
{__init__,embeddings,rrf}.py`, `app/schemas/retrieval.py`,
`app/routers/{ingest,retrieval}.py` (ingest hosts manifest POST +
validate POST), `app/main.py` (2 registrations),
`.env.example` (`CURATOR_AUTH_IDS` + provider/R2 names + `RRF_K`,
all optional), `scripts/{enrich,r2_sync,reindex}.py`
(lazy heavy imports — zero new runtime deps; pacing/checkpoints/
multipart resume), `tests/test_{retrieval,ingest}_contract.py` +
`test_retrieval_golden.py` + `test_cache_isolation.py` (first batch:
403 gate, URL trust, normalization, 503 mismatch + roundtrip,
sync-invariant proofs, wipe isolation), chain-pin bump,
`docs/operations/retrieval.md` runbook (local model ID, switch
procedure, CONCURRENTLY note, pacing, backup = R2 + manifests).

## 11. Risks / review asks (disposition of Claude review 2026-09-26)

1. ~~`tsv GENERATED` on Neon~~ RESOLVED in spec: literal regconfig,
   no trigger fallback (dead complexity removed).
2. ~~HNSW builds~~ RESOLVED in spec: incremental on inserts; full
   rebuilds go through `CREATE INDEX CONCURRENTLY` per runbook.
3. ~~Any-authenticated ingest~~ RESOLVED in spec: `CURATOR_AUTH_IDS`
   allowlist → 403 `CURATOR_ONLY`, gates before build.
4. ~~`local` 1024d refusal~~ ACCEPTED + documented: runbook names the
   friction (real 1024d model required).
5. ~~Shared cache keys~~ STATED explicitly: all authenticated users
   may read all subjects; key schema must gain user scope if that
   ever changes.
6. Caps sane? (200 chunks/req, 8 KB fields, 24k-char bundle, topK ≤20,
   RRF k=60, rates 10/300 + 60/60.) Open — plus note: 60/60 tightens
   if frontend ever fans out multi-query turns.
7. RRF+MMR with zero learned rerank — accepted for P1 against §8
   projections; empirical numbers are the exit bar, P3 is the
   fallback.
8. NEW from review, all applied: per-chunk `embed_provider`/`embed_model`
   stamp + 503 `EMBED_SPACE_MISMATCH` (§§4–6); single-writer sync
   invariant + read-back proof (§§4–5, §9); `r2_key`-canonical
   equality check (§6.1); Astryx-vs-Astro terminology lock (§12).
   Terminology: "Astryx" = UI kit 0.5.2, "Astro" = framework — not a
   typo.
