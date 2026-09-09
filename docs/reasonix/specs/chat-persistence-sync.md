# Spec (shared contract): chat persistence + history sync — Phase 2

Status: Proposed
Stack: FastAPI + SQLAlchemy + Alembic (Neon) / Astro + React 19 + Astryx 0.5.2.
Context: backend `Chat` containers are fully CRUD'd (`routers/chats.py`) but carry
no bodies ("deferred spec owns `messages`"); frontend store is memory-only
(`session.ts` header 2026-09-07 — nothing survives reload, purge of `pesdac-*`
localStorage already shipped). Guests stay memory-only (no user row exists).

This document is the frozen contract for three parallel streams (see
`docs/reasonix/plans/chat-persistence-plan.md`). Streams MUST NOT renegotiate
these shapes; any defect found becomes a report, never a unilateral change.

## 1. Goals

1. Signed-in users: chats + turns survive reload and follow them across devices.
2. Guests: behavior byte-identical to today (memory-only, dies on reload).
3. Server is source of truth when authenticated; memory is a write-through
   render cache, never a second truth.
4. Slice-12 optimistic contract everywhere: snapshot → paint → persist →
   reconcile-or-rollback + toast. No silent divergence, ever.

## 2. Non-goals

- No LLM/real responder (Phase 1 owns `responder.ts`; the stub keeps running).
- No offline queue (offline mutation fails with toast, memory keeps current paint).
- No votes persistence (stays memory-local), no drafts sync (ephemeral by design).
- No demo-thread message sync (static content + local overrides + `demo_state`
  row behavior all unchanged).
- No service worker, no new deps, no Astryx/theme change.

## 3. Backend contract (Stream A builds; B/C consume — FROZEN)

### 3.1 Migration `0006_messages` (Alembic, with downgrade)

`messages`: `id` UUID PK; `chat_id` UUID FK→`chats.id` `ondelete=CASCADE`
(deleting a chat purges its turns, mirroring `deleteCustomChat`'s overlay
purge); `seq` INT (per-chat order, server-assigned); `role` VARCHAR(16) with
CHECK `IN ('user','assistant','system')`; `content` JSONB (a serialized `Block`
payload — bubbles/attachments metadata as JSON, never blobs); `created_at`
tz-aware. `UNIQUE(chat_id, seq)` + index `(chat_id, seq)`.

### 3.2 Endpoints (all under `/api/v1/chats`, authed via `get_current_user`)

| Method + path | Req | Success | Errors |
|---|---|---|---|
| `POST /{code}/messages` | `{role, content}` | 201 `MessageOut` | 404 unknown-or-demo code (`NOT_FOUND` "Chat not found." — no oracle distinction); 422 bad role / non-object content / serialized content > 100KB |
| `GET /{code}/messages?limit&offset` | limit default 200, max 200 | 200 `{data:[MessageOut asc by seq], pagination}` (slice-13 envelope) | 404 as above |
| `DELETE /{code}/messages?from_seq=N` | N ≥ 0 | 200 `{data:{deleted:N}, pagination:{limit:0,offset:0,total:N}}` (mirrors `clear_chats`) deletes `seq >= N` | 404 as above; 422 negative N |

`MessageOut = {id: string, seq: int, role: string, content: object, createdAt: str}`.

Rules: containers API unchanged; `seq` = max+1 with retry ×3 on
`IntegrityError` (mirrors `_insert_or_select` doctrine); successful append
touches `chat.updated_at` (sidebar ordering keeps working); every mutation leg
keeps origin check + rate limit (`chat-messages-append` 60/60, truncate 60/60,
list = read, no limit); 401s flow through the existing envelope handler.

## 4. Frontend client contract (Stream B builds; C imports — FROZEN)

New module `frontend/src/lib/chat-sync.ts` (new file; ZERO edits to existing
files). Pure `apiFetch` wrappers; identity handled inside `apiFetch`/epoch by
callers. Errors propagate as `ApiError` (no toasts inside this module):

```ts
export type ServerChat = { code, subject, title, isPinned, isArchived, createdAt, updatedAt: string };
export type ServerMessage = { id: string; seq: number; role: "user"|"assistant"|"system"; content: unknown; createdAt: string };
apiListChats(): Promise<ServerChat[]>
apiCreateChat(subject: string, title: string): Promise<ServerChat>
apiPatchChat(code: string, patch: {title?; isPinned?; isArchived?}): Promise<ServerChat>
apiDeleteChat(code: string): Promise<void>
apiClearChats(): Promise<{ deleted: number }>
apiListMessages(code: string): Promise<ServerMessage[]>
apiAppendMessage(code: string, m: {role; content: unknown}): Promise<ServerMessage>
apiTruncateMessages(code: string, fromSeq: number): Promise<{ deleted: number }>
```

## 5. Sync doctrine (Stream C implements)

- **Reads stay synchronous** from the memory cache (components don't change
  shape); **mutations become async** server write-through with snapshot
  rollback + toast (slice-12 contract). Call sites updated accordingly.
- **Hydrate:** on transition to authenticated for identity K (epoch-gated,
  `TaggedCache` philosophy): `apiListChats()` replaces memory customs (server
  wins, cross-device truth). Guests and `unknown`-tag windows never hydrate.
- **First-sync pin/archive migration:** memory `PINS_KEY`/`ARCHIVE_KEY` sets
  translate to one `PATCH` per flagged chat present in the server list, once —
  afterwards server flags are authoritative and the key-sets retire (reads
  switch to flags; sets deleted).
- **Guest→login adopt (best-effort, bounded):** non-empty memory customs at
  first authenticated hydrate are POSTed (container + their overlay blocks as
  messages, preserving order) then dropped from memory. Any failure keeps the
  memory copy untouched for the next login (never half-adopt: per-chat
  all-or-nothing — container + all its messages, or skip the chat).
- **Turns:** opening a custom chat loads messages once (loading → skeleton per
  slice-12 mapping; failure → toast, memory paint stays). Send appends the user
  block optimistically, persists it, then persists the assistant block at
  stream completion (stop persists the partial — today's semantics preserved).
  Edit = truncate-from-index + resend; regenerate = delete-last + rerun.
  `seq` is server-assigned; memory order is append-order (no client seq).
- **401 mid-sync:** global auth-required flow owns it (existing); memory keeps
  current paint, no error UI beyond the global one.

## 6. Acceptance (whole phase)

- [ ] Reload mid-thread (authed): sidebar + full turn history restore; guests still lose everything (documented, unchanged).
- [ ] Forced failure on each mutation restores the exact prior paint + one toast.
- [ ] Cross-user code access 404s; demo codes reject message writes; oversize content 422s.
- [ ] Login with guest customs adopts them once; failed adopt retries next login, never duplicates (per-chat all-or-nothing).
- [ ] Backend 41+new tests green; frontend 104+new green; `astro check` + `build` + `git diff --check` clean; zero backend diffs from frontend streams and vice versa.
