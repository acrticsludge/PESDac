# Chat history storage: least bytes, fastest reads — 2026-09-10

Category: Architecture / Persistence
Status: Proposed
Scope: `backend/app/models/chats.py`, `backend/app/routers/chats.py`, `backend/app/schemas/chats.py`, `backend/app/models/profiles.py:62`, `frontend/src/content/threads/types.ts`, `frontend/src/lib/session.ts:45,175-226,750-753`
Goal: store AI chat history for the least Postgres bytes while keeping sidebar + open-thread reads fast. No UI change (per `AGENTS.md`).

---

## 1. What we store today (evidence)

Split is already right — containers vs. bodies:

- `Chat` (`models/chats.py:15-41`): `id UUID`, `user_id`, `code(6)` unique, `subject`, `title(34)`, `is_pinned`, `is_archived`, timestamps. List endpoint returns this only, no bodies (`routers/chats.py:32-37,51-70`). Ordering `is_pinned DESC, updated_at DESC`, `limit<=100`.
- `Message` (`models/chats.py:44-71`): `id UUID`, `chat_id`, `seq` per-chat (`uq_messages_chat_seq` + `ix_messages_chat_seq`), `role` check, `content` JSONB (`users.py:21` — `JSONB` on Postgres), `created_at`. Append assigns `seq = max+1` with retry (`routers/chats.py:161-185`). List is `seq ASC`, `limit<=200` (`188-204`). Truncate deletes `seq >= from_seq` (`207-228`).
- Wire cap: `content` JSON serialized > 100KB → 422 (`schemas/chats.py:14-16,90-95`).
- Client (`session.ts:45,175-226`): whole `Record<code, Block[]>` lives under one `OVERLAY_KEY`; every `getOverlay/appendBlocks/setOverlay` parses + restringifies the **entire map**. `hydrateChats` replaces the full list; `loadChatMessages` replaces the full overlay (`750-753,1023-1058`).
- `Block` (`threads/types.ts:85-117`): `UserBlock {from, bubbles[], attachments?, time}`, `AssistantBlock {from, bubbles[], toolCalls?, toolCallsExpanded?, toolCallsAfter?, footer?, followUps?, error?, time}`, `SystemBlock {text, variant}`. `Bubble` union has 10 variants (`73-83`), several verbose (`mcq` with full options + answer + explanation, `steps`, `code`, `image/pdf` with labels).

This gives us two cost centers: **bytes** (verbose repeated JSON) and **read amplification** (full-map parse + full-thread fetch).

## 2. Where bytes actually go

Rough per-turn sizes (JSONB, before TOAST compression):

| Payload | Typical bytes | Notes |
|---|---|---|
| User text turn | 150–400 | `{"from":"user","bubbles":[{"type":"text","text":"…"}],"time":"…"}` — keys + ISO time dominate short turns |
| Assistant markdown answer | 1–8KB | `md` string dominates; `footer`, `followUps[]` add 100–500B |
| MCQ / steps / code bubble | 2–15KB | options + explanation + code duplicated every turn, never deduped |
| `toolCalls[]` | 200–800 | `name/target/status/duration` repeated per turn |
| Render-only fields | 50–200/turn | `time` string, `toolCallsExpanded`, `toolCallsAfter`, `retryText`, `footer` (derivable as `PESDac · {subject}`) |
| Attachments | metadata only today (good) | `Attachment {id,name,mime,size}` (`types.ts:15-20`) — keep it that way; blobs must never enter `messages.content` |
| UUIDs | 36B text each | `id` per message as text in `_msg_out` (`routers/chats.py:40-44`); PG stores 16B, wire pays 36B |

Biggest lever is **not** compression — it is **not storing render state + not refetching bodies to render lists**.

## 3. Where latency actually goes

1. Sidebar doesn't need bodies and already doesn't fetch them — keep it. Cost is `SELECT chats WHERE user_id + archived + (subject, ILIKE title)` (`routers/chats.py:61-69`). `ILIKE %q%` cannot use a btree; fine <10k chats/user, cliff after.
2. Open thread fetches up to 200 full JSONB rows + client replaces the whole overlay and re-renders (`session.ts:1044`). 200 × 5KB = 1MB per open. Slow on mobile.
3. Client full-map JSON parse on every keystroke-adjacent read (`readJSON(OVERLAY_KEY)`) is O(total history) per call — dominates UI jank before the network does.

## 4. Recommended architecture (least storage + fast retrieval)

Keep Postgres + current two-table shape. Add columns, subtract JSON, page reads. No new infra.

### 4.1 Store less per row (no migration of old rows required)

1. **Strip render-only fields before `apiAppendMessage`.** Client-side `blockToMessage` (`session.ts:784-789`) should delete `time`, `toolCallsExpanded`, `toolCallsAfter`, `error.retryText`, `footer` (recompute at render: `footer ?? PESDac · subject`). Server renders `time` from `createdAt`. Saves ~10–20% on short turns, zero query change.
2. **Short keys on the wire, canonical on read.** Optionally map `from: "u"|"a"|"s"`, `type: "t"|"md"|"code"…` at write, expand in `messageToBlock`. Only worth it if median turn <500B; otherwise skip (hurts debuggability for small gain). Prefer step 1 first.
3. **Reference, don't inline.** Artifacts: store `artifactId` only (`ArtifactBubble` already does — keep; never inline `Artifact.markdown` per turn). Images/PDFs: metadata + object-store URL only. MCQ: acceptable to store full (needed offline), but cap `explanation` length.
4. **Rely on TOAST; don't pre-gzip JSONB.** PG TOAST already compresses large `content` out-of-line. App-level gzip saves ~30% more on big markdown but kills `SELECT content->>` indexing and debuggability. Skip unless a chat p99 exceeds 50KB/turn.
5. **Dedupe attachments by hash.** `(sha256, mime, size)` table when uploads land; messages keep `{hash, name}`. Prevents re-upload of the same slides N times.

### 4.2 Read less per screen (the fast-retrieval half)

1. **Sidebar: metadata only, server-paged.** Already true — enforce it: pass `subject/q/archived/limit/offset` from the history page instead of in-memory filter. Add index:
   ```sql
   CREATE INDEX ix_chats_user_updated ON chats (user_id, is_archived, is_pinned DESC, updated_at DESC);
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE INDEX ix_chats_title_trgm ON chats USING gin (title gin_trgm_ops);
   ```
2. **Add a preview column to avoid body reads for list/search.** Add to `chats`: `preview TEXT (≤280 chars)`, `msg_count INT DEFAULT 0`, `last_seq INT DEFAULT 0`, updated on append/truncate in the same transaction that touches `updated_at` (`routers/chats.py:170`). List/search render from `preview`; bodies fetched only on open. This is the single biggest read win.
3. **Thread: windowed `seq` paging.** Change open-thread load to `latest 50` (`offset = max(0,total-50)`) + "load older" (`offset -= 50`). Keep `seq ASC` + existing `ix_messages_chat_seq`. Keep full-replace `setOverlay` for the window; prepend older windows. Avoids the 200-row 1MB open.
4. **Search titles first, bodies only on demand.** `q` hits `chats.title` (trigram) + `preview`. Full message-content search (if ever needed) goes to a separate `message_fts TSVECTOR` generated column + GIN index — never `LIKE %…%` over JSONB.
5. **Count without bodies.** History page totals come from `pagination.total` + `msg_count`, never `SELECT content`.

### 4.3 Retention (storage cap with one switch)

`profiles.retention` already exists (`profiles.py:62`, default `"forever"`). Enforce server-side with a nightly job, not client deletes:

```sql
-- retention in {forever, 30d, 90d, 1y}; purge chats whose updated_at < now() - interval
DELETE FROM chats WHERE user_id = :uid AND updated_at < now() - :interval;
-- messages cascade via FK (models/chats.py:55-56, cascade all delete-orphan :39-41)
```

Offer "export before purge" using the existing `{data, pagination}` envelope + `dumpStore()` semantics. This bounds storage per user without any client logic.

### 4.4 Client cache (stop O(history) parses)

- Split `OVERLAY_KEY` per chat (`pesdac-overlay:{code}`) or keep in-memory `Map<code, Block[]>` without JSON round-trip per read. Lazy-load per open chat; LRU-evict closed chats (keep ~5). This removes the biggest frontend jank source with no API change.
- Keep `hydrateChats` adopt-then-replace and `seq` server-assigned; add idempotency key on adopt later (known duplicate risk), not needed for storage savings.

## 5. Migration order (smallest diff first)

1. Client strip render-only fields in `blockToMessage` (no migration, immediate ~15% write savings).
2. Add `preview/msg_count/last_seq` columns + update in append/truncate transaction; backfill `preview = LEFT(content->0->>'text' …)` once.
3. Add the two indexes above (`CONCURRENTLY` in prod).
4. Thread `subject/q/archived/limit/offset` through `chat-sync.ts` to the history page; switch thread open to latest-50 window.
5. Per-chat overlay cache split; LRU eviction.
6. Nightly retention purge honoring `profiles.retention`.
7. Only if search-on-bodies is requested: `message_fts` generated column + GIN.

## 6. What NOT to do

- Blobs/base64 in `messages.content` (breaks the 100KB contract and TOAST paging).
- E2E-encrypting `content` per user (kills trigram/FTS, preview, and server retention).
- Keyset-per-keystroke drafts server-side (keep drafts client-only; persist on send).
- Separate `threads` + `turns` + `bubbles` normalized tables (joins cost more than JSONB for <200 turns/chat; normalize only if per-bubble queries are required).
- App-level gzip of every row (marginal gain, loses queryability).

## 7. Acceptance

- [ ] Median stored turn smaller (measure `pg_column_size(content)` p50/p99 before/after step 1).
- [ ] Sidebar list issues zero body reads (`EXPLAIN` shows index-only on `ix_chats_user_updated` / trigram for `q`).
- [ ] Open thread fetches ≤50 bodies; scroll-back pages with same `seq` window.
- [ ] `astro check` + `npm.cmd test` + `build` + `git diff --check` green; no UI/copy change.
