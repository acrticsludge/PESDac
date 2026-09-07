# Slice 13 — API envelope consistency + pagination typing

> **Status:** SHIPPED.
> **Date:** 2026-09-07.
> **Skill applied:** `api-and-interface-design` (audit in `docs/api-design-audit.md`).

## 1. Problem

The audit identified four deviations from the API design skill's "consistent error semantics" rule:

1. **`/ready` 503** (`routers/health.py:27`) returns `{"ok": false}` — no envelope. Different shape from every other 4xx/5xx in the app.
2. **`get_current_user` 401** (`deps.py:74`) raises `HTTPException(status_code=401, detail="Unauthorized")` — FastAPI's default shape is `{detail: "Unauthorized"}`, NOT the `{error: {code, message}}` envelope. The other 401 paths (JWT verify, `AuthRequiredError`) use the envelope. Two 401 shapes for the same status.
3. **`ChatListOut.pagination: dict`** is too loose. The router returns `{limit, offset, total}`; the schema should type it so OpenAPI and the frontend can rely on the shape.
4. **`DELETE /chats`** returns `{deleted: N}` — different shape from `GET /chats` (which uses `{data, pagination}`). Same operation family, different envelope.

## 2. Decision

Fix all four in one slice:

- `/ready` 503 → `{error: {code: "UNHEALTHY", message: "Database unavailable."}}`.
- `get_current_user` 401 → replace `HTTPException` with `JSONResponse(content=error_body("UNAUTHORIZED", "Authentication required."))`. This matches the `UNAUTHORIZED` constant already exported from `schemas/common.py`.
- `ChatListOut.pagination` → typed `Pagination` Pydantic model with `limit: int`, `offset: int`, `total: int`.
- `DELETE /chats` → `{data: {deleted: N}}` (the same envelope, with `pagination: {limit: 0, offset: 0, total: N}` so the frontend's `apiFetch` returns the same shape as a list).

## 3. Why now

These are the four largest sources of "the consumer can't predict behavior" in the current API. Fixing them now is the smallest possible cost: zero new endpoints, zero frontend changes, zero new dependencies.

The skill says: "Don't mix patterns. If some endpoints throw, others return null, and others return { error } — the consumer can't predict behavior." That's exactly the situation here.

## 4. What changes

| File | What |
|---|---|
| `backend/app/routers/health.py` | 503 returns `error_body("UNHEALTHY", "Database unavailable.")` |
| `backend/app/deps.py` | `get_current_user` 401 returns `JSONResponse(error_body("UNAUTHORIZED", "Authentication required."), status_code=401)` |
| `backend/app/schemas/chats.py` | New `Pagination` model; `ChatListOut.pagination: Pagination` |
| `backend/app/routers/chats.py` | `clear_chats` returns `{data: {deleted: N}, pagination: {limit: 0, offset: 0, total: N}}` |

## 5. Why pagination shape stays

The skill recommends `{page, pageSize, totalItems, totalPages}`. PESDac uses `{limit, offset, total}`. Don't change. The One-Version Rule and the existing frontend code make the switch a break, and the value is zero — both shapes paginate, both are RESTful, both work. The slice fixes typing, not naming.

## 6. What does NOT change

- 204 No Content responses stay bare (per HTTP spec).
- 200 OK responses with full resource bodies stay as-is.
- Error message text is not changed — only the envelope shape.

## 7. Tests

| File | What |
|---|---|
| `backend/tests/test_health_contract.py` (NEW) | `/ready` 200 on healthy; 503 with envelope on DB error. |
| `backend/tests/test_auth_contract.py` | 401 on missing/invalid token uses the envelope. (Already covers some — extend.) |
| `backend/tests/test_chats_contract.py` | `clear_chats` returns `{data:{deleted:N}, pagination:{limit:0,offset:0,total:N}}`. |
| `backend/tests/test_chats_contract.py` | `list_chats` pagination shape is typed (model dump). |

## 8. Rollback

Revert the four files. No data migration, no API versioning. Five-minute revert.

## 9. Out of scope

- Splitting `frontend/src/lib/auth.ts` into `lib/api/*.ts` modules. Audited but the cost-benefit favors leaving it until a second consumer needs to import the same API client. Documented in `docs/api-design-audit.md` §3 P3.
- Validating the BetterAuth upstream response in `link_password`. Audited as P3 (low risk, single server, trusted); deferred.
- Branded types for IDs. Audited and rejected — the wire format is a string and the ergonomic cost outweighs the type safety win.
- Documenting the API in `docs/API.md`. P3; this slice focuses on the code-level fixes.

## 10. Increments

| # | Where | What |
|---|---|---|
| 13.1 | `backend/app/routers/health.py` | 503 envelope. |
| 13.2 | `backend/app/deps.py` | 401 envelope. |
| 13.3 | `backend/app/schemas/chats.py` | `Pagination` model. |
| 13.4 | `backend/app/routers/chats.py` | `clear_chats` envelope + return type annotation. |
| 13.5 | `backend/tests/test_health_contract.py` (NEW) | Health tests. |
| 13.6 | `backend/tests/test_auth_contract.py` | Add 401 envelope assertion. |
| 13.7 | `backend/tests/test_chats_contract.py` | Add `clear_chats` envelope + pagination typing assertion. |

After 13.7: `python -m pytest` green; every 4xx/5xx in the app uses the same `{error: {code, message}}` envelope.
