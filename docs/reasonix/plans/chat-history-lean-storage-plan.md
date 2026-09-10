# Plan: chat history lean storage + ditto history skeletons (3 streams)

Spec: `docs/reasonix/specs/chat-history-lean-storage.md` (FROZEN — streams build against it; defects become reports, never unilateral edits).
Status: Proposed.
Branch rule: one branch per stream from main; never commit to main; do not push/commit unless the user explicitly asks.
Skills: `neon` + `neon-postgres` govern all DB work (branch-first, pooled app vs direct migrations, `neon inspect db` verify).

## Stream file-ownership (exclusive — a stream touching another stream's files stops and reports)

| Stream | Branch | Owns (ONLY these) | Must NEVER touch |
|---|---|---|---|
| A backend lean columns + indexes + retention | `feat/chat-history-lean-backend` | `backend/app/models/chats.py` (3 columns only), `backend/alembic/versions/0007_chat_preview_counts.py` (new), `backend/app/routers/chats.py` (`_out` + append/truncate txn + list ordering only), `backend/app/schemas/chats.py` (`ChatOut` extension only), `backend/app/routers/profiles.py` or retention job file (purge only, if one exists — else report, do NOT invent a scheduler) | `frontend/*`, theme, CSS, `ThreadView.tsx`, skeleton components |
| B frontend write-less + windowed reads | `feat/chat-history-lean-reads` | `frontend/src/lib/session.ts` (`blockToMessage` strip only), `frontend/src/lib/chat-sync.ts` (`limit/offset/q/subject/archived` passthrough only), `frontend/src/components/chat/ThreadView.tsx` (history window `limit=50` + load-older only), `frontend/src/components/Pesdac.tsx` (sidebar/search query threading only), `frontend/tests/chat-history-lean.test.ts` (new) | `backend/*`, `ChatListSkeleton.tsx`, `ComposerSkeleton.tsx`, `ThreadSkeleton.tsx`, `SkeletonBlock.tsx`, theme, CSS |
| C ditto history skeletons (reuse, no new placeholders) | `feat/chat-history-ditto-skeletons` | `frontend/src/components/Pesdac.tsx` (skeleton placement lines only — reuse `ChatListSkeleton` + `skeletonRows`), `frontend/src/components/chat/ThreadView.tsx` (`showHistorySkeleton` condition only — reuse `ThreadSkeleton`), `frontend/src/components/profile/sections.tsx` (History `SkeletonCard` lines only — reuse as-is), no new test file (coverage lives in B) | `session.ts`, `chat-sync.ts`, `backend/*`, any skeleton component file (reuse as-is, never restyle), theme, CSS |

Rationale: A owns PG truth; B owns bytes-on-wire + windows; C owns zero-shift swaps and reuses all three skeleton components byte-identical (same method as `chat-skeleton-ditto-fix.md`). B codes against A's frozen `_out` shape from the start (`preview/msgCount/lastSeq`) with fallback (title-only rows + full-window load when absent) — never stubs backend.

## Dependency order

```text
FROZEN contract (spec §6 + §9) ─┬─ A (backend: columns + backfill + indexes + _out + purge)
                                 ├─ B (frontend: strip + passthrough + window=50 + tests; falls back until A lands)
                                 └─ C (skeletons: reuse only; independent, verifiable before A/B land)
A + B + C run in parallel, zero conflict surface (disjoint file sets except Pesdac/ThreadView owned lines differ — C touches placement lines, B touches query lines; if both land on the same hunk, stop and report).
```

## My merge procedure (lead reviewer = me, after all streams land)

1. Merge A → main on a Neon branch first: `neon checkout feat-chat-history-lean`, `neon diff`, run Alembic upgrade with **direct** URL, backfill, `neon inspect db table-sizes/index-sizes/seq-scans`, backend `pytest` green. Then prod deploy (indexes `CONCURRENTLY`).
2. Rebase B onto new main; remove preview-fallback only where A proves present (keep fallback guard — old rows/branches stay safe); re-run `npm.cmd test`, `astro check`, `build`.
3. Rebase C onto new main; confirm diff is placement-only, zero skeleton-component edits; re-run gates.
4. Full gates: backend `pytest`, frontend `npm.cmd test`, `npm.cmd run astro -- check`, `npm.cmd run build`, `git diff --check`.
5. User-assisted browser matrix:
   - F1: authed refresh → indented `ChatListSkeleton` rows → real titles, no shift, network shows `GET /chats` with no `content` field
   - F2: open thread → `ThreadSkeleton` 3-turn template → real turns, composer live; network shows `limit=50`; scroll-back prepends older window
   - F3: search `q` + subject filter → server-filtered title + preview rows, clear restores pinned/updated order
   - F4: Profile History loading → `SkeletonCard History rows=1` → real retention/export/delete rows, no reflow
   - F5: guest + demo: zero skeletons, zero fetches; forced hydrate/history failure → memory + one toast each
   - Narrow viewport, clean console, no 504s

## File touch budget

- Max five touched source files per stream (expected: A five, B five, C three). Exceeding it means the stream was mis-scoped — split and report.

## Detailed fixes per stream

### Stream A: Backend lean columns + indexes + retention

- Migration `0007_chat_preview_counts.py` (Alembic): `ALTER TABLE chats ADD COLUMN preview TEXT`, `msg_count INT DEFAULT 0 NOT NULL`, `last_seq INT DEFAULT 0 NOT NULL`; backfill once (`preview = LEFT(...) ≤280`, counts from `messages`); nullable → backfill → `NOT NULL` where applicable. Run with direct URL (`DATABASE_URL_UNPOOLED`), never pooled.
- `models/chats.py`: 3 columns only, same names/defaults. No other model change.
- `routers/chats.py`: `_out` += `preview/msgCount/lastSeq`; append/truncate update all three in the same txn that touches `updated_at`; list keeps `is_pinned DESC, updated_at DESC`, `limit<=100`; messages list keeps `seq ASC`, `limit<=200` (callers send 50).
- `schemas/chats.py`: `ChatOut` += same three fields. 100KB cap unchanged → 422.
- Indexes (`CONCURRENTLY` in prod): `ix_chats_user_updated (user_id, is_archived, is_pinned DESC, updated_at DESC)` + `pg_trgm` + `ix_chats_title_trgm USING gin (title gin_trgm_ops)`. Verify with `EXPLAIN` + `neon inspect db`.
- Retention: nightly purge per `profiles.retention` (`DELETE FROM chats WHERE updated_at < now() - interval`, messages cascade). If no job file exists, wire the SQL + report where the scheduler should live — do NOT invent a new infra service.

### Stream B: Frontend write-less + windowed reads

- `session.ts` `blockToMessage` only: delete `time`, `toolCallsExpanded`, `toolCallsAfter`, `error.retryText`, `footer`; drop empty `followUps[]`. Assert `artifactId`-only, metadata-only attachments. No predicate/hydrate logic change.
- `chat-sync.ts` only: thread `limit/offset` (messages) and `q/subject/archived/limit/offset` (list) through, same `{data, pagination}` envelope (one-version rule, `api-design-audit.md §2.5`).
- `ThreadView.tsx` history window only: open `limit=50, offset=max(0,total-50)`; scroll-back `offset -= 50`, prepend. Keep `overlay.length === 0` memory-wins + `isHistoryLoading` OR.
- `Pesdac.tsx` query threading only: sidebar/search sends server params instead of in-memory filter; counts from `pagination.total` + `msgCount`.
- New `frontend/tests/chat-history-lean.test.ts` (node:test, no DOM): strip helper, preview ≤280, count/seq increment + truncate-decrement. Existing suites unmodified.

### Stream C: Ditto history skeletons (reuse only)

- `Pesdac.tsx` placement lines only: workspace collapsible `VStack`s use existing `skeletonRows` clamp with `ChatListSkeleton` (`140×14 r1`, md slot, `index` stagger, `aria-busy/label`); never section-level block; never `workspaceCustoms.length`; never add a leading icon.
- `ThreadView.tsx` condition only: reuse `ThreadSkeleton` (user `180+120`, assistants `280+200`/`220`, metadata `96×10`, toolcall-shape only with proof); composer live.
- `sections.tsx` History lines only: keep `SkeletonCard title="History" rows={1}` + `Your data rows={2}` during `auth.status === "loading"`; real card byte-identical. Do NOT invent placeholders, overlays, modals, or spinners.

## Risks

- Pooled-URL migration failure (`prepared statement "s0" already exists` / lost `SET`) → bounded by direct-URL rule; any migration run on pooled stops and re-runs direct.
- Index build locking prod → bounded by `CONCURRENTLY`; non-concurrent index DDL stops and reports.
- B landing before A (missing `preview`) → bounded by fallback guard (title-only rows + full-window load); hard-coding preview-present stops and reports.
- B/C colliding on the same `Pesdac.tsx`/`ThreadView.tsx` hunk → stop and report (exclusive-line rule), never resolve by editing the other's lines.
- Bare-bar skeleton temptation / app-gzip temptation / body-search scope creep → all forbidden by spec FR3/§4; stop and report.
- `workspaceCustoms.length` cold-`0` trap + leading-icon re-add → same bounds as the `/new` fix.
- Hydration mismatch: no `typeof window`, no random values in touched UI paths.
