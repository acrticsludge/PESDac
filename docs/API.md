# PESDac API Contract (`/api/v1`)

Date: 2026-09-14. Status: Implemented (describes the tree; scanned from
`backend/app/routers/*`, `backend/app/schemas/*`, `backend/app/main.py`).
OpenAPI: `/api/openapi.json`, docs UI: `/api/docs`. Frontend base is the
host-only `PUBLIC_API_BASE_URL`; `apiFetch` appends `/api/v1` to every path.

## Auth model

Every route below except `/health` and `/ready` requires
`Authorization: Bearer <BetterAuth JWT>`. The backend verifies the JWT
per request (no sessions, no cookies, no frontend-supplied user id —
verified claims are the sole identity source). Cross-user access
answers 404, never 403-differentiated existence. Mutations additionally
require an allowlisted `Origin`/`Referer` (`FRONTEND_ORIGINS`, exact
match) and may be rate-limited (429 + `Retry-After`, see table).

Same-origin Astro routes (not `/api/v1`, served by the frontend host):
`POST /api/auth/[...slug]` (BetterAuth handler),
`POST /api/link-password` (in-process `setPassword`; the old backend
proxy could only 404 — slice-12b). `GET /api/v1/auth/*` below is the
FastAPI side.

## Envelopes (one shape everywhere)

- Success: the resource, or `{data, pagination}` for lists and
  clear-chats. `204` carries no body.
- Failure: `{error: {code, message, details?}}` on every 4xx/5xx —
  including 401s from missing/invalid tokens (normalized by the global
  handler in `app/main.py`), 503 from `/ready`, and 422s (details are
  `{loc, msg, type}` only — never raw input or validator internals).
- 500s are generic with a server-log reference (`Something went wrong.
  Reference: <ref>.`); the frontend never sees internals. Frontend copy
  mapping lives in `frontend/src/lib/api/errors.ts` (`toUserMessage`).

## Pagination (locked)

`{limit, offset, total}` — kept deliberately (the frontend consumes it;
see `api-design-audit.md` §2.5). Do not migrate to page/pageSize
without value. `ChatListOut.pagination` / `MessageListOut.pagination`
are typed (`Pagination`: limit/offset/total). Chat list: default 50,
max 100. Messages: default 50, max 200. Export is capped at 200 rows.

## Idempotency

- `POST /chats` accepts optional `clientAdoptKey` (≤64 chars): a
  retried adopt resends the key and gets the existing row back.
- `POST /chats/{code}/messages` accepts optional `clientMsgKey`
  (≤64 chars): retries are safe by construction; the outbox replays it
  verbatim (`frontend/src/lib/outbox-db.ts`).
- `DELETE /users/me` is idempotent: missing row is "already deleted",
  204 either way. `DELETE /users/me` hard-deletes profile, chats, demo
  state, and credentials (cascade), then wipes the user's cache prefix.

## Routes

| Method | Path | Success | Notable failures |
|---|---|---|---|
| GET | `/health` | 200 `{ok:true}` (no DB touch) | — |
| GET | `/ready` | 200 `{ok:true}` | 503 `{error:{code:UNHEALTHY}}` when the DB is down |
| GET | `/auth/me` | 200 `{user:{id,email,displayName,onboardingDone}}` (upserts on first call; mirrors BetterAuth `name`) | 401 UNAUTHORIZED |
| POST | `/auth/logout` | 204 (no-op by design; the SDK `signOut` owns revocation — see session semantics in `betterauth-integration.md`) | 401 |
| GET | `/profiles/me` | 200 full profile (auto-creates a blank row on first read; read-through cached, 60 s TTL) | 401 |
| PATCH | `/profiles/me` | 200 full profile (partial body; unknown fields rejected, `extra="forbid"`; cache invalidated) | 401, 403 origin, 422, 429 `profiles-patch` 60/60 |
| GET | `/chats` | 200 `{data, pagination}` (subject/q/archived filters; pinned-first) | 401 |
| POST | `/chats` | 201 chat (adopt replay with a seen `clientAdoptKey` answers 200, same shape, no duplicate) | 401, 403 origin, 422, 429 `chats-create` 60/60, 409 CODE_COLLISION (code-allocation race; retry) |
| PATCH | `/chats/{code}` | 200 chat | 401, 403 origin, 404, 422 |
| DELETE | `/chats/{code}` | 204 | 401, 403 origin, 404 |
| DELETE | `/chats` | 200 `{data:{deleted}, pagination:{limit:0,offset:0,total}}` | 401, 403 origin, 429 `chats-clear` 10/300 |
| POST | `/chats/{code}/messages` | 201 message (`seq` server-assigned; content JSON ≤100 KB) | 401, 403 origin, 404, 422, 429 `chat-messages-append` 60/60, 409 CONFLICT (append race; retry) |
| GET | `/chats/{code}/messages` | 200 `{data, pagination}` (`seq` ASC) | 401, 404 |
| DELETE | `/chats/{code}/messages?from_seq=N` | 200 `{data, pagination}` envelope (deletes `seq >= N`) | 401, 403 origin, 404, 429 `chat-messages-truncate` 60/60 |
| GET | `/demo-state` | 200 overrides only (demo content stays static in the frontend) | 401 |
| PUT | `/demo-state/{label}` | 200 override (`extra="forbid"`) | 401, 403 origin, 422, 429 `demo-put` 60/60 |
| GET | `/users/me/export` | 200 `{profile, chats, demoState, exportedAt, version:1}` (secret-free, ≤200 rows per collection) | 401 |
| DELETE | `/users/me` | 204, idempotent (see above) | 401, 403 origin, 429 `users-delete` 10/300 |

`/llm/*` (`GET /status`, `PUT /key`, `DELETE /key`) belongs to the LLM
phase — contract in `docs/reasonix/specs/llm-byok-settings.md`, not here.

## What NOT to change

- Pagination shape, envelope shape, `/v2` versioning (additive
  evolution; input `extra="forbid"` keeps new fields optional).
- Branded ID types (wire format is string; cost exceeds value at this
  scale — revisit on a real ID-confusion bug).
