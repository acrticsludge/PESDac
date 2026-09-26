# Retrieval operations runbook (P1)

Backend-only. No frontend steps. Curator machine holds all credentials;
the repo carries names only (`backend/.env.example`).

## 1. R2 layout (normative)

Single bucket `pesdac-media`, public custom-domain read, curator-write
only:

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
        diagrams/
          bridge-rectifier-p042.png
        manifest.json
```

`kind` is a DB/source attribute, NOT a path level. `r2_key` is the
canonical identity (`subjects/{SUBJECT}/{unit}/…`); URLs are derivable
as `R2_PUBLIC_BASE + r2_key`. Every chunk asset URL must share the
`R2_PUBLIC_BASE` origin AND sit under `subjects/{subject}/{unit}/`.

## 2. Curator flow: enrich → sync → manifest

From `backend/` on the curator machine:

```powershell
# 1. Enrich a unit dir into manifest.json (quota-paced, checkpointed)
$env:R2_PUBLIC_BASE="https://media.example/"
python scripts/enrich.py --subject CN --unit unit-1 --kind slides `
  --title "Unit 1 slides" --r2-key subjects/CN/unit-1/slides.pdf `
  --unit-dir ./media/CN/unit-1 --out ./media/CN/unit-1/manifest.json

# 2. Upload originals to R2 (local creds, multipart, resumable)
$env:R2_ACCOUNT_ID="<id>"; $env:AWS_ACCESS_KEY_ID="<key>"
$env:AWS_SECRET_ACCESS_KEY="<secret>"
python scripts/r2_sync.py --unit-dir ./media/CN/unit-1 --bucket pesdac-media

# 3. Dry-run validation (no writes), then ingest (curator only)
# POST /api/v1/ingest/validate with the manifest body → {ok, chunk_count, warnings[]}
# POST /api/v1/ingest/manifest with the manifest body → {source_id, chunk_count} (201;
# 200 on idempotent re-POST with the same x-client-ingest-key header)
```

`CURATOR_AUTH_IDS` (comma-separated `auth_user_id` or email, matched
case-insensitively) gates both ingest legs — anyone else gets 403
`CURATOR_ONLY`. Re-ingest without a key replaces chunks
(delete-then-insert, `version` bumped); re-POST with the same key
returns the original `{source_id, chunk_count}` as 200.

## 3. Quota math (Workers AI: 10k neurons/day, free, no CC)

- Neuron estimate per chunk ≈ `len(text fields) // 4`; each ingest
  records its sum in `ingest_events.neurons_estimate`.
- `GET /api/v1/retrieval/health` exposes the cached 24 h rolling sum
  as `neurons_24h_estimate` — watch burn before the 502s arrive.
- One 48-page PDF ≈ 50k tokens ≈ 5 days of quota: `enrich.py`
  estimates up front, processes in `--budget` chunks (default 9000),
  and pauses with exit 2 + checkpoint when the day is spent. Rerun
  tomorrow to resume.
- Enrichment captioning MUST use `CF_ENRICH_ACCOUNT_ID` /
  `CF_ENRICH_API_TOKEN` (dedicated pair); sharing the live-search
  account lets a big enrichment run burn the 10k/day budget and knock
  out student search until UTC midnight. When the enrich pair is
  unset, captioning falls back to the local VLM.

## 4. Provider switch procedure

One provider is active (`RETRIEVAL_EMBED_PROVIDER` — no fallback
chain). Switching after data exists does NOT migrate rows: search
detects the mix via stamped columns and answers 503
`EMBED_SPACE_MISMATCH` ("Search index needs a refresh.") until
re-indexed.

```powershell
# In-place re-embed with the ACTIVE provider (batched, resumable)
python scripts/reindex.py --batch 32
# Dry run first (no writes):
python scripts/reindex.py --dry-run --provider hash --limit 5
```

Delete-then-insert through `POST /ingest/manifest` is the equivalent
heavier path. Verify with `GET /api/v1/retrieval/health` (counts +
provider) and one seeded search before announcing.

## 5. Index-parameter changes

`CREATE INDEX chunks_hnsw …` builds incrementally on inserts — manifest
POSTs never rebuild. Changing `m`/`ef_construction` later requires
`CREATE INDEX CONCURRENTLY` **outside** Alembic's transactional
migration (run manually on the DIRECT url, never pooled). Measure
HNSW-vs-brute-force recall drift against prod Neon per §9 before and
after; SQLite CI cannot observe ANN order (contract tests assert
shape/caps/determinism, never exact ANN order).

## 6. Backup story

- Originals: R2 bucket (versioned at the bucket, curator-synced).
- Corpus intent: per-unit `manifest.json` files (re-ingestable).
- Derived vectors: recompute via `reindex.py` or re-ingest (never
  backed up directly — 4 KB/chunk at 100k chunks ≈ 400 MB; P3 halves
  it with a `halfvec` migration).
- Audit: `ingest_events` rows (who ingested what, when) + per-request
  `X-Request-ID` headers for log correlation.

## 7. Local dev friction (named, not hidden)

Local embedding needs the exact 1024d weights **`BAAI/bge-m3`** (same
space as prod — that's the point). Habit-reach MiniLM 384d is refused
by design (`ValueError`, never adapted). Tests use the `hash`
provider (no creds, deterministic). `TYPESAFE_API_KEY` is reserved
for the later rerank phase: backend env only, never frontend, never
the repo — P1 code never reads it.

## 8. Failure copy (UI-ready by contract)

| Code | Surface meaning |
|---|---|
| 502 `EMBED_UNREACHABLE` | "Couldn't reach the embedding service. Nothing was saved. Try again." (ingest) / "Search is temporarily unavailable. Try again in a bit." (search) |
| 503 `EMBED_MISCONFIGURED` | "Embedding isn't configured on this server." / "Search isn't configured on this server." |
| 503 `EMBED_SPACE_MISMATCH` | "Search index needs a refresh. Let your instructor know." (student-safe; never names the curator role) |
| 429 `RATE_LIMITED` | 60/60 search, 10/300 ingest — `Retry-After` header; revisit only if prod 429s exceed 1% of search traffic over 7 d |
