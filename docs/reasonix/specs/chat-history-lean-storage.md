# Spec: chat history lean storage + ditto history skeletons

Status: Proposed
Audit basis: code inspection only (no code changed for this spec) — `backend/app/models/chats.py:15-71`, `backend/app/routers/chats.py:32-70,147-204`, `backend/app/schemas/chats.py:14-16`, `frontend/src/content/threads/types.ts:73-117`, `frontend/src/lib/session.ts:45,175-226`, `frontend/src/components/chat/ChatListSkeleton.tsx`, `frontend/src/components/chat/ComposerSkeleton.tsx`, `frontend/src/components/chat/ThreadSkeleton.tsx:19-66`, `frontend/src/components/profile/SkeletonBlock.tsx:17-86`, `frontend/src/components/profile/sections.tsx:1123-1153`, `docs/audits/2026-09-10-chat-history-storage.md`.
Stack: Astro + React 19 + Astryx 0.5.2 + StyleX + `PESDacMockupTheme` + FastAPI + Lakebase Postgres via Neon (per `AGENTS.md`; installed skills `neon` + `neon-postgres` govern all DB work).
Skills applied: `neon` (branch-first flow, pooled vs direct, `neon checkout` + `neon env pull`, migration safety), `neon-postgres` (Drizzle as ORM, direct URL for migrations, `neon inspect db` diagnostics, Lakebase Search for future FTS only).

## 1. Problem

Two defects share one root — history costs too much and loads unlike itself:

**H1 — history stores render state, not just content.** `Message.content` persists full `Block` payloads (`threads/types.ts:85-117`): `time` ISO strings, `toolCallsExpanded`, `toolCallsAfter`, `footer` (`PESDac · {subject}`, recomputable), `error.retryText`, `followUps[]`. Short user turns pay 150–400B where keys + time dominate; assistant turns duplicate `footer`/`followUps` per row. Nothing strips these before `apiAppendMessage`, so every byte is stored in JSONB + TOAST forever. No `preview`/`msg_count`/`last_seq` on `chats` — sidebar, search, and counts re-read bodies or full overlays (`session.ts:175-226` parses the whole `OVERLAY_KEY` map per read; open thread fetches up to 200 full rows).

**H2 — history skeletons are not ditto.** Same doctrine violation as the `/new` sidebar/composer fix (`chat-skeleton-ditto-fix.md` D1–D3): wherever history loads, placeholders must live in the real Astryx shells at the real sizes. Concretely: sidebar history rows must reuse `ChatListSkeleton` (label-only `140×14`, `SideNavItem md` slot, no leading icon — real Subjects rows pass none); open-thread history must reuse `ThreadSkeleton` (real `ChatMessage` + `Avatar md` + `ChatMessageBubble variant="ghost"` + `ChatMessageMetadata 96×10`, user `180+120`, assistants `280+200` / `220`, toolcall-shape `160×32 r2` only with proof); Profile → History card must reuse `SkeletonCard`/`SkeletonRow` (icon `20×20 r2` + `140×14`/`200×12` + control `192×32 r2`, `CONTROL_WIDTH`, divider, `Card variant="muted"`). A bare bar/circle block floating outside these shells is forbidden — it shifts on swap and breaks the no-reflow rule.

## 2. Users

- Signed-in users reopening history (sidebar list → open thread) on desktop + <=640px.
- Signed-in users searching/filtering history by title/subject.
- Guests / demo readers: zero change (memory-only, zero fetches, zero skeletons).

## 3. Goals

1. Least-bytes persistence: strip render-only fields at write; reference (never inline) artifacts/blobs; rely on TOAST, no app-gzip; list/search/count never read bodies.
2. Fast retrieval: metadata-only sidebar/search from `chats` (+ `preview`/`msg_count`/`last_seq`); windowed `seq` paging for threads (latest 50 + load-older); trigram index for `q`; counts from `pagination.total` + `msg_count`.
3. Ditto skeletons on every history surface (sidebar list, open thread, Profile History card) inside real shells at real sizes — same method as the `/new` sidebar + composer fix.
4. Retention bounded: `profiles.retention` enforced server-side (nightly purge, cascade), export-before-purge preserved.
5. Neon-safe delivery: branch-first (`neon checkout`, `neon diff`), pooled app traffic vs direct migrations, Drizzle-managed schema, verify with `neon inspect db`.

## 4. Non-goals

- No visual redesign, theme edit, Astryx upgrade, Tailwind, global CSS, or copy change.
- No E2E encryption of `content` (kills trigram/FTS/preview/retention).
- No blobs/base64 in `messages.content` (100KB cap stays; uploads go to object storage with metadata only).
- No per-bubble normalized tables (`threads`/`turns`/`bubbles` joins cost more than JSONB for <=200 turns/chat).
- No full message-body search in this spec (title + preview only; Lakebase Search / `TSVECTOR` is a named future, not this diff).
- No ThreadView send/stream/edit/regenerate/vote logic change; no mutation `Spinner` change.

## 5. User flows

### F1: Sidebar history refresh (lean + ditto)

1. Authed refresh → `showChatListSkeleton` true → indented `ChatListSkeleton` rows inside the correct workspace collapsibles (same `skeletonRows` clamp 1–3 as `/new`).
2. `GET /chats` (metadata only, `limit<=100`) resolves → real titles land in place, no shift. Bodies never fetched for the list.

### F2: Open thread from history (windowed + ditto)

1. Open backed chat with empty overlay → `ThreadSkeleton` 3-turn template inside real `ChatMessage` shells; composer stays live.
2. `GET /chats/{code}/messages?limit=50&offset=total-50` resolves → real turns replace the window; scroll-back prepends older windows (`offset -= 50`). Never a 200-row 1MB open.

### F3: Search / filter history

1. Type in search → debounced `GET /chats?q=&subject=&archived=false` (server filters, trigram-backed) → title + `preview` rows render from metadata.
2. Clear → back to default ordering (`is_pinned DESC, updated_at DESC`), no body reads.

### F4: Retention / export / delete-all (unchanged surfaces, enforced backend)

Profile History card keeps `SkeletonCard title="History" rows={1}` while `auth.status === "loading"` (`sections.tsx:1123-1130`), then the real retention `Selector` + Export + Delete-all rows. Purge runs nightly per `profiles.retention`; export uses the existing `{data, pagination}` envelope.

### F5: Guest / demo (unchanged)

Zero skeletons, zero fetches, byte-identical rendering.

## 6. Functional requirements

### FR1: Write less (client strip, no migration)

- `blockToMessage` (`session.ts`, current append path) deletes before POST: `time`, `toolCallsExpanded`, `toolCallsAfter`, `error.retryText`, `footer` (render recomputes `footer ?? PESDac · subject`; `time` renders from `createdAt`). `followUps` stays only when the turn genuinely has suggestions — never an empty array.
- Artifacts: `artifactId` only (already true — assert, never inline `Artifact.markdown`). Images/PDFs: `{id,name,mime,size,url}` metadata only.
- Server keeps 100KB serialized cap (`schemas/chats.py:14-16`) → 422, never 500. No app-gzip. No short-key remap in this spec (revisit only if p50 turn <500B after strip).

### FR2: Read less (columns + indexes + paging)

- Add to `chats` (Drizzle-managed, nullable-safe with backfill): `preview TEXT (≤280 chars)`, `msg_count INT DEFAULT 0 NOT NULL`, `last_seq INT DEFAULT 0 NOT NULL`. Updated in the same transaction that touches `updated_at` on append/truncate (`routers/chats.py:147-228`); backfill once (`preview = LEFT(...)`, `msg_count/last_seq` from `messages`).
- `_out` (`routers/chats.py:32-37`) includes `preview/msgCount/lastSeq`; `ChatOut` schema extended identically. List/search/count render from these — bodies fetched only on open.
- Indexes (`CONCURRENTLY` in prod):
  ```sql
  CREATE INDEX ix_chats_user_updated ON chats (user_id, is_archived, is_pinned DESC, updated_at DESC);
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX ix_chats_title_trgm ON chats USING gin (title gin_trgm_ops);
  ```
  Existing `uq_messages_chat_seq` + `ix_messages_chat_seq` (`models/chats.py:63-68`) unchanged and reused for windowing.
- Thread open: `limit=50`, `offset=max(0,total-50)`, `seq ASC`; scroll-back decrements offset. `chat-sync.ts` threads `limit/offset` through (same `{data, pagination}` envelope, per `api-design-audit.md §2.5` one-version rule). Sidebar/search thread `subject/q/archived/limit/offset` through instead of in-memory filter.
- Counts from `pagination.total` + `msg_count`; never `SELECT content`.

### FR3: Ditto history skeletons (same method as `/new` fix)

- Sidebar history: reuse `ChatListSkeleton` as-is (`VStack gap={0.5}`, row `HStack` with `minHeight var(--size-element-md)` + `paddingInlineStart var(--spacing-2)`, `Skeleton 140×14 r1`, `index` stagger; no leading icon; `aria-busy` + `aria-label="Loading chats"`). Placement inside each workspace collapsible `VStack` using existing `skeletonRows`; never a section-level floating block; never `workspaceCustoms.length` (cold-`0` → `null` trap).
- Open thread: reuse `ThreadSkeleton` as-is (3-turn template per `ThreadSkeleton.tsx:19-66`, `aria-label="Loading chat history"`, no `isStreaming`/follow-ups/artifact panel, toolcall-shape only with proof). Condition keeps `overlay.length === 0` memory-wins + `isHistoryLoading` OR (`ThreadView.tsx:786-793`); composer live throughout.
- Profile History: reuse `SkeletonCard title="History" rows={1}` + `title="Your data" rows={2}` during `auth.status === "loading"` (`sections.tsx:1123-1130`); real card is `SettingsCard` + `CardRows` + `SettingsRow` (icon + `140×14`/`200×12` + control `192×32`, `Card variant="muted"`, divider) — skeleton already dittos this; keep byte-identical, do not invent a new placeholder.
- Forbidden: bare bars/circles outside these shells; full-area overlays/modals/spinners; skeletoning the subject toggles or suggestion cards (they stay `isDisabled`, never skeletoned).

### FR4: Retention + export + delete (wire, don't redesign)

- Nightly purge honors `profiles.retention` (`forever | 30d | 90d | 1y`): `DELETE FROM chats WHERE updated_at < now() - interval` per user; messages cascade via FK + ORM cascade (`models/chats.py:39-41,55-56`). Export-before-purge offered on the existing export path. `DELETE /chats` (delete-all) and per-chat `DELETE /{code}` semantics unchanged.

### FR5: No other behavior change

Predicates (`shouldShowChatListSkeleton`/`shouldShowThreadSkeleton`), `hydrateChats` adopt-then-replace, `seq` server-assigned with retry, mutation rollback + single-toast contract, shortcuts, search input liveness, guest/demo paths: untouched.

## 7. Acceptance criteria

- [ ] AC1: Stored p50/p99 turn bytes drop (`pg_column_size(content)` before/after FR1); no 422 regressions on real turns.
- [ ] AC2: Sidebar/search render zero bodies (`EXPLAIN` hits `ix_chats_user_updated` / trigram; response rows carry `preview`, no `content`).
- [ ] AC3: Open thread fetches ≤50 bodies; scroll-back pages the same `seq` window; 200-row opens gone.
- [ ] AC4: Every loading state dittos: sidebar rows land with no shift, thread template → real turns with composer live, Profile History card swaps with no reflow; guests/demos/ready-empty show zero skeletons.
- [ ] AC5: Retention purge deletes only expired `chats` (+ cascaded `messages`); export still round-trips.
- [ ] AC6: `npm.cmd test` + `npm.cmd run astro -- check` + `npm.cmd run build` + `git diff --check` pass; backend `pytest` green; `neon inspect db table-sizes/index-sizes/seq-scans` reviewed before/after index deploy.
- [ ] AC7: Astryx UI/theme/copy/layout unchanged; desktop + <=640px; clean console.

## 8. Constraints

- `AGENTS.md` UI rules apply in full. Max five touched source files per stream (see plan to follow).
- Work from main; branch per stream; no commit/push unless asked. Branch-first DB flow: `neon checkout <branch>`, `neon diff`, verify on branch data before prod.
- Synthetic fixtures only; no PII in tests/migrations/backfills.

## 9. API / interface requirements

- `GET /chats` keeps `{data: ChatOut[], pagination}`; `ChatOut += { preview: string, msgCount: number, lastSeq: number }`. Query: `archived/subject/q/limit/offset` (existing) — frontend must actually send them.
- `GET /chats/{code}/messages` keeps `{data: MessageOut[], pagination}`; callers send `limit/offset` (default open: `limit=50`).
- `POST /chats/{code}/messages` unchanged shape; content is stripped `Block` (FR1). `chat-sync.ts` + backend contracts otherwise FROZEN in shape (one-version rule).
- Presentational: `ChatListSkeleton({rows})`, `ThreadSkeleton()`, `SkeletonCard({title, rows})` — no fetching, no new props except existing aria.

## 10. Data requirements (Neon per installed skills)

- Drizzle owns schema + migrations as code (`neon-postgres` setup flow). Pooled URL (`-pooler`, `DATABASE_URL`) for app traffic; **direct URL for migrations/dumps** (`DATABASE_URL_UNPOOLED`), never pooled (`prepared statement "s0" already exists` / lost `SET` failure mode).
- Test every migration on a branch against prod-like data (`neon checkout`, `neon diff`) before prod; backfill `preview/msg_count/last_seq` in the same deploy as the column add (nullable → backfill → `NOT NULL` where applicable).
- Pooling via PgBouncer for serverless bursts; autoscale/scale-to-zero left at defaults unless `inspect` says otherwise. Future body search (out of scope) uses Lakebase Search / `TSVECTOR` + GIN — never `LIKE %…%` over JSONB.

## 11. Security requirements

- Identity-scoped everything: every chat/message query filters `(user_id[, code])`; cross-user code → same 404 (no existence oracle, per `routers/chats.py:1-3`).
- No tokens/PII in skeletons, logs, previews beyond the user's own title, or tests. Strip does not remove safety-relevant `role`/`content` semantics.
- Origin + rate-limit checks on mutations stay (`check_mutation_origin`, `rate_limit.check`).

## 12. Testing requirements

- Unit (node:test, no DOM lib): strip helper (render-only fields gone, `role`/`bubbles` intact; empty `followUps` dropped); preview truncation (≤280); `msg_count`/`last_seq` increment + truncate-decrement; predicate truth tables unchanged (pending+0→skeleton, ready-empty→real list, guest→none, overlay>0→no thread skeleton).
- Backend (pytest): append assigns `max+1` under race (existing retry), truncate deletes `seq >= from_seq` + updates preview/counts, retention purge boundary, cross-user 404s, 100KB cap → 422.
- Existing `auth-session-flow` + `chat-backing` + skeleton suites pass unmodified (extend by new files, never rewrite assertions).
- Browser (user-assisted): F1–F5 desktop + narrow; throttled hydrate/history to observe each ditto skeleton; `EXPLAIN` + `neon inspect db outliers/calls/table-sizes` spot-check; clean console.

## 13. Rollout / rollback

- Rollout: backend columns + indexes (`CONCURRENTLY`) → backfill → `_out` extension → frontend strip + paging + skeleton reuse. No flag/env/migration beyond Drizzle + nightly purge schedule. Land behind branch deploys per skill flow.
- Rollback: revert stream branches; `preview/msg_count/last_seq` ignored when absent (frontend falls back to title-only rows + full-window load); behavior returns to today's verbose rows + full fetches + current skeletons. No data loss (strip is forward-only for new rows; old rows untouched).
