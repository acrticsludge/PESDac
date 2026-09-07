# PESDac API & Interface Audit

> **Status:** Audit complete; fixes shipped in Slice 13.
> **Date:** 2026-09-07.
> **Skill applied:** `api-and-interface-design`.

## 1. Inventory

### Endpoints (Backend — FastAPI on `/api/v1`)

| Method | Path | Auth | Source | Status codes |
|---|---|---|---|---|
| GET | `/health` | none | `routers/health.py:15` | 200 |
| GET | `/ready` | none | `routers/health.py:20` | 200, **503 (bare `{ok:false}`, no envelope)** |
| GET | `/auth/me` | JWT | `routers/auth.py:19` | 200, 401, 500 |
| POST | `/auth/logout` | JWT | `routers/auth.py:37` | 204 |
| POST | `/auth/link-password` | JWT + origin + rate-limit | `routers/auth.py:48` | 200, 400, 401, 403, 422, 429, 500, 502 |
| GET | `/profiles/me` | JWT | `routers/profiles.py:25` | 200, 401, 500 |
| PATCH | `/profiles/me` | JWT + origin + rate-limit | `routers/profiles.py:31` | 200, 401, 403, 422, 429, 500 |
| GET | `/chats` | JWT (paginated) | `routers/chats.py:42` | 200, 401, 500 |
| POST | `/chats` | JWT + origin + rate-limit | `routers/chats.py:64` | 201, 401, 403, 409, 422, 429, 500 |
| PATCH | `/chats/{code}` | JWT + origin | `routers/chats.py:85` | 200, 401, 403, 404, 422, 500 |
| DELETE | `/chats/{code}` | JWT + origin | `routers/chats.py:107` | 204, 401, 403, 404, 500 |
| DELETE | `/chats` | JWT + origin + rate-limit | `routers/chats.py:119` | 200 (`{deleted:count}`), 401, 403, 429, 500 |
| GET | `/demo-state` | JWT | `routers/demo_state.py:29` | 200, 401, 500 |
| PUT | `/demo-state/{label}` | JWT + origin + rate-limit | `routers/demo_state.py:35` | 200, 401, 403, 422, 429, 500 |
| GET | `/users/me/export` | JWT | `routers/users.py:25` | 200, 401, 500 |
| DELETE | `/users/me` | JWT + origin + rate-limit | `routers/users.py:39` | **202** (no body), 401, 403, 429, 500 |

### Module boundaries (Frontend)

| Module | Exports | Consumers |
|---|---|---|
| `lib/auth.ts` | `useAuth`, `useProfile`, `useAccounts`, `signIn`, `signUp`, `signOut`, `signInWithGoogle`, `linkGoogle`, `linkPassword`, `unlinkAccount`, `enableTwoFactor`, `verifyTwoFactorSetup`, `verifySignInTwoFactor`, `disableTwoFactor`, `changePassword`, `apiGetMe`, `apiUpdateProfile`, `apiGetProfile`, `apiGetAccounts`, `apiLogout`, `apiDeleteAccount`, `apiFetch`, `useToast`, `toUserMessage`, `MIN_PASSWORD_LENGTH`, `ApiError`, `AuthRequiredError`, `ApiErrorBody`, `AuthUser`, `ServerProfile`, `SessionUser`, `AuthState`, `LinkedAccount`, `AccountsState`, `ProfileState` | 7 component files, AppToasts |
| `lib/session.ts` | `useSessionVersion`, `getProfile`, `updateProfile`, `dumpStore`, `clearAllChats` | every section, Pesdac, ThreadView |
| `lib/chat.ts` | `CHAT_CODES`, `DEMO_LABELS` | sidebar, ThreadView, demo_state router (the set is the source of truth on both sides) |
| `lib/auth-client.ts` | `authClient` (BetterAuth SDK) | `lib/auth.ts` only |
| `lib/buffer-polyfill.ts`, `lib/events-polyfill.ts` | polyfills | Astro config aliases |

## 2. Audit findings (against the skill)

### 2.1 Contract First — **PASS**

- Every endpoint has a typed input schema (Pydantic `BaseModel` with `extra="forbid"` on PATCH/PUT) and a typed output schema (or a `model_config`-explicit return).
- `schemas/profiles.py` carries the API camelCase ↔ DB snake_case mapping as a single tuple (`PROFILE_FIELDS`).
- `schemas/chats.py` has both `ChatOut` and `ChatListOut` declared but **the routers return raw dicts, not Pydantic models** — the type guarantee ends at the schema file.

### 2.2 Consistent Error Semantics — **PARTIAL PASS**

- The error envelope `{error: {code, message, details?}}` is consistently used in 14 of 15 places.
- **One red flag:** `routers/health.py:27` returns `{"ok": false}` (no envelope) on 503. Inconsistent.
- **One 401 inconsistency:** `app/deps.py:74` raises `HTTPException(status_code=401, detail="Unauthorized")` — FastAPI's default shape is `{"detail": "Unauthorized"}`, NOT the envelope. Every other 401 in the app comes from the JWT verify path which uses the envelope. This means 401 from "no header" / "no token" looks different from 401 from "invalid token".

### 2.3 Validate at Boundaries — **PASS**

- All PATCH/PUT bodies have Pydantic validators at the route edge (`schemas/profiles.py`, `schemas/chats.py`).
- BetterAuth upstream responses are NOT validated before use. The link-password proxy trusts `resp.is_success` and `resp.json()`; if BetterAuth's response shape changes, the link-password route silently passes bad data through. **Risk: low (BetterAuth is our own server)**, but a 5xx from BetterAuth with an unexpected body shape would be forwarded to the client.
- The BetterAuth session JWT is verified via JWKS at the boundary (`app/auth/betterauth.py`); trusted after that.
- The frontend's `apiFetch` parses any JSON but type-narrows the result via `safeJson` + `isErrorBody` — not great, but defensive.

### 2.4 Prefer Addition Over Modification — **PASS**

- All schemas use `extra="forbid"` on input (clients can't send extra fields).
- Output schemas (`ChatOut`, `ProfileOut`, `DemoOut`) are flat — adding a new field is safe; old clients ignore it.
- PATCH accepts `None` for every field; new fields are added as new `Optional` entries.

### 2.5 Predictable Naming — **PASS**

- REST endpoints use plural nouns (`/chats`, `/demo-state`, `/users`).
- Query params are camelCase (none in current code).
- Response fields are camelCase (`isPinned`, `isArchived`, `createdAt`).
- Boolean fields use `is/has/can` prefix (`isPinned`, `isArchived`, `onboardingDone`, `twoFactorEnabled`).
- One **subtle smell:** `DELETE /chats` (no `{code}`) returns `{"deleted": N}` instead of using a `data` + `meta` envelope like the list endpoint. Different shape for the same operation family. Not a bug, but inconsistent.

### 2.6 Validation & Pydantic typing details

- **`ChatListOut.pagination: dict`** is too loose. The router returns `{limit, offset, total}` — the schema should be a typed `Pagination` model so the contract is checkable in OpenAPI and the frontend can rely on the shape.
- **The `pagination` field is also not the skill's recommended shape.** The skill says `{page, pageSize, totalItems, totalPages}`. PESDac uses `{limit, offset, total}`. The One-Version Rule says: don't change what the frontend already consumes unless it adds value. **Keep the current shape; document it explicitly.**

### 2.7 Module boundaries — **PASS with one concern**

- `lib/auth.ts` is 693 lines and exports 25+ items. It's a god-module that everyone imports. The boundary it enforces is "every fetch goes through `apiFetch`" — which is good. But adding every new API call as a top-level export means it grows indefinitely.
- **The single-responsibility split is overdue:** separate `lib/api/profile.ts`, `lib/api/chats.ts`, `lib/api/demo-state.ts` would localize the contract. The `apiFetch` helper stays shared.

### 2.8 The cross-cutting concern the user actually hit

The user said: "90% of the error states don't exist, user sees backend error that pop up in the card rather than a toast." The two real causes:

1. **`toUserMessage` was reading `error.message` blindly** — so 404 became "Not Found" (the FastAPI `res.statusText` default for the 404 envelope when our own route wasn't matched), which is unhelpful. **Fixed in slice 12E** with explicit 404/5xx branches.
2. **Every section-level error was rendered as a `<Text type="supporting">` at the bottom of the section card.** The user's eyes interpret that as "in the card" because the surrounding SettingsCard gives it visual weight. **Fixed in slice 12E** by converting all section-level errors to toasts.

## 3. What to fix (concrete)

| Priority | What | File | Effort |
|---|---|---|---|
| P1 | `health.py:27` 503 returns `{"ok":false}` — wrap in envelope | `backend/app/routers/health.py` | 1 line |
| P1 | `deps.py:74` 401 raises `HTTPException` — replace with `JSONResponse(error_body("UNAUTHORIZED", "Unauthorized"))` | `backend/app/deps.py` | 3 lines |
| P2 | `ChatListOut.pagination: dict` → typed `Pagination` model | `backend/app/schemas/chats.py` | 10 lines |
| P2 | `DELETE /chats` returns `{deleted:N}` — wrap in `{data: {deleted: N}}` for envelope consistency | `backend/app/routers/chats.py` | 1 line + 1 test |
| P3 | Split `lib/auth.ts` into per-domain `lib/api/*.ts` modules. Keep `apiFetch`, `ApiError`, `AuthRequiredError`, `toUserMessage` in `lib/api/`. Move `useAuth`/`useProfile`/`useAccounts` to a thin re-export from `lib/auth.ts` for the consumer side. | `frontend/src/lib/auth.ts` + new `lib/api/*.ts` | 60-80 lines moved, no behavior change |
| P3 | The `link-password` BetterAuth upstream response is trusted. Wrap with a tiny `isSetPasswordResponse(v): v is { status: boolean }` guard before treating as success. | `backend/app/routers/auth.py` | 5 lines + 1 test |
| P3 | Document the pagination shape (current: `{limit, offset, total}`) in an `API.md` so the frontend can stop guessing. | new `docs/API.md` | 60 lines |

## 4. What NOT to fix

- **Pagination shape:** don't switch to `{page, pageSize, totalItems, totalPages}`. The current shape matches the chat list; switching breaks the consumer. Document it.
- **Versioning:** no `/v2/` etc. The One-Version Rule means additive evolution. `extra="forbid"` on input means new fields must be optional anyway.
- **Branded types (`UserId`, `ChatId`):** the current code uses `string` everywhere. Branded types are correct in TypeScript theory, but the wire format is a string and the ergonomic cost of casting at every call site is high for a single-developer project. Skip until a real consumer confuses the IDs.
- **A `from`/`to` for `index`/skill's name:** this audit doc IS the design record. No new ADR file.

## 5. Verification

After shipping the P1 + P2 fixes, the following must hold:

- [ ] Every 4xx response from every route has the `{error: {code, message, details?}}` envelope.
- [ ] `GET /ready` on DB failure returns `{error:{code:"UNHEALTHY",...}}` 503, not bare `{ok:false}`.
- [ ] `GET /chats` response's `pagination` field is typed (Pydantic model, not `dict`).
- [ ] `DELETE /chats` response shape is `{data: {deleted: N}}` for consistency.
- [ ] Existing 29 backend tests still pass.
- [ ] Frontend still parses list responses without changes (the field names didn't move).
