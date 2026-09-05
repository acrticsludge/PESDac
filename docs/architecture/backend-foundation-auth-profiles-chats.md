# Architecture: backend foundation, profiles, chats, Neon JWT verify

Backend service (`backend/`, FastAPI) for PESDac. **Authentication is
owned by Neon Auth** (Managed Better Auth in our Neon project) — the
backend verifies Neon JWTs against `NEON_AUTH_JWKS_URL` and is otherwise
stateless about identity.

This file is authoritative for our backend surface. The frontend
side of auth lives in `docs/reasonix/specs/login-signup.md` (v6) and
`docs/reasonix/plans/login-auth-surface.md`.

## 1. Goals

- Resource ownership for chats, profiles, demo-state overrides, and
  export/delete-all/delete-account, keyed by the verified Neon user.
- Neon JWT verification at the boundary (no per-request HTTP call to
  Neon; JWKS is cached, 1h TTL by `kid`).
- Neon Postgres 16 + `vector` extension enabled (RAG-ready) without
  creating any document/chunk/embedding tables yet.
- Schema includes a `users` table keyed by `neon_user_id` (the `sub`
  claim) and a `profiles` table for our per-user preferences; both
  are 1:1 with the Neon user.

Non-goals (deferred with owner):

- Message bodies + turn history + edit/regenerate server rewrite →
  dedicated messages spec (extension points in §8).
- Turn feedback/votes server persistence → rides with messages.
- Uploads (`POST /uploads`), SSE streaming, share links, quiz
  checking, context meter → their own specs per backend-readiness
  audit §4.
- Ingestion pipeline, document tables, embeddings, retrieval → future
  RAG phase. `vector` extension is enabled now so that phase is
  `CREATE TABLE` only, not an ops change.
- **All password / 2FA / passkey / session / reset / OAuth UI work
  is Neon-owned.** Our backend has no `password_*`, `refresh_tokens`,
  `oauth_accounts`, or `password_reset_tokens` tables.

## 2. Decisions (locks the audit §1 blockers)

| # | Decision | Rationale |
|---|---|---|
| D1 | Separate API service (`backend/`, FastAPI), Astro stays static | Keeps RAG in Python; avoids Astro hybrid/SSR migration. CORS + env config instead of same-origin endpoints. |
| D2 | Neon Auth is the auth surface; our backend verifies the JWT | Neon Auth ships email+password, Google OAuth, forgot-password, verify-email, 2FA, passkeys. Re-implementing any of these in our backend would be wrong and would violate "Astryx-only chrome" for the profile surface. |
| D3 | Neon Postgres 16 + `vector` extension enabled at migration 0001 | pgvector present with zero vector columns so the RAG phase adds tables only. |
| D4 | Ed25519 JWT verify against `NEON_AUTH_JWKS_URL` (cached 1h) | No state in our backend. No token minting. No session cookies. The frontend sends `Authorization: Bearer <jwt>`. |
| D5 | No email of any kind from our app | Neon handles all transactional email. |
| D6 | Drafts never leave the tab's memory | Matches `chat-power.md` §9. No draft endpoint, ever. |
| D7 | Demo threads stay static in the frontend; only per-user overrides persist | `convo-mgmt.md`. Backend stores overrides, never demo content. |
| D8 | API versioned at `/api/v1` from the first endpoint | First API is the cheapest time to version. |

## 3. System shape

```text
Browser  →  Frontend (Astro 4321, static)
                │  Authorization: Bearer <Neon JWT>
                ▼
            FastAPI (8000)
                │  Ed25519 verify vs NEON_AUTH_JWKS_URL (cached 1h)
                ▼
            Neon Postgres (sessions/users/chat containers/profiles)
                ▲
                │  (independent)
           Neon Auth (REST API on *.neonauth.* origin)
                │  HTTP-only session cookie + access_token JWT
                ▼
            Frontend SDK (@neondatabase/neon-js)
```

## 4. Schema (PG-idiomatic DDL — PG types only; SQLite used by pytest
mirrors the portable subset)

```sql
-- 0001_foundation (existing)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS citext;  -- optional, falls back to text + lower() unique index

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  display_name    text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- No password_hash, email_verified_at, oauth_accounts,
-- refresh_tokens, or password_reset_tokens in v6.

-- 0002 added profiles.campus + profiles.onboarding_done (kept in v6
-- because the onboarding wizard still writes them).

-- 0003_neon_auth_link (new for v6) replaces any auth-shaped columns
-- from the 0002 v5 experiment with a minimal `users` table keyed by
-- neon_user_id. Downgrade 0002 -> 0001 first if coming from v5.
```

## 5. What changed between v5 and v6

v5 had its own auth (argon2, opaque refresh tokens, password reset
emails, Authlib Google exchange, sessions listing, JWT issuance). All
of that is now Neon-owned and is being torn out of the backend in
this rework. Concretely:

- Migration `0002_auth_security` is being split: the
  `profiles.campus` / `profiles.onboarding_done` columns stay (needed
  by onboarding + Campus selector), the rest is dropped.
- A new migration `0003_neon_auth_link` is the canonical v6 schema.
- Routers being removed: `POST /auth/password/change`,
  `POST /auth/password/set`, `GET /auth/sessions`,
  `DELETE /auth/sessions/{id}`, `GET /auth/google/start`,
  `GET /auth/google/callback`, the OAuth helpers
  (`_pretty_device_label`, `_exchange_google_code`,
  `_find_or_create_user`), and the `hasPassword` / `googleConnected`
  flags on `/me`.
- Routers being added: `GET /auth/me` (verify + upsert), `POST
  /auth/logout` (no-op 204), `app/auth/neon.py` (JWKS cache + Ed25519
  verify), `app/deps.py:get_current_user_from_neon`.

## 6. Environment

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon pooled URL, `sslmode=require`. App refuses to boot without it. |
| `NEON_AUTH_BASE_URL` | yes | The base URL Neon gives on the Auth → Configuration tab. |
| `NEON_AUTH_JWKS_URL` | yes | `${NEON_AUTH_BASE_URL}/.well-known/jwks.json`. Cached for 1h by `kid`. |
| `FRONTEND_ORIGINS` | yes | Comma-separated allowlist. CORS preflight must pass for the browser to send the JWT. Empty = boot failure. |
| `COOKIE_SECURE` | no | Default true; false only for `http://localhost` dev. |
| `RATE_LIMIT_LOGIN`, `RATE_LIMIT_SIGNUP` | no | Defaults §9. |

`.env.example` documents all of the above. No other env is read.
`import.meta.env` in the frontend is limited to
`PUBLIC_API_BASE_URL` + `PUBLIC_NEON_AUTH_URL` — no secret ever gets
a `PUBLIC_` prefix.

## 7. API contract (`/api/v1`, JSON, error envelope §9)

Auth model for every endpoint below: `Authorization: Bearer <Neon JWT>`.
The frontend SDK injects this on every `apiFetch`. JS never reads
Neon's cookie.

### 7.1 Auth (v6 — minimal)

```http
GET /api/v1/auth/me
  → 200 { "user": { "id", "email", "displayName", "onboardingDone" } }
  → 401 UNAUTHORIZED on missing/invalid/expired token
  Side effect: first call upserts our `users` row by `sub` (Neon
  user id) and returns it. Re-calls return the same row.
POST /api/v1/auth/logout
  → 204 (no-op on our side; the frontend SDK calls Neon to invalidate
  the session)
```

### 7.2 Profiles (now keyed by Neon user)

```http
GET  /api/v1/profiles/me   → 200 { full profile } | 404 if not yet created
PATCH /api/v1/profiles/me
  body: any subset of { displayName?, institution?, semester?, branch?,
    subjects?, examMonth?, weeklyGoal?, difficulty?, depth?, verbosity?,
    proactiveQuiz?, followUps?, citations?, retention?, language?,
    region?, campus?, onboardingDone?, timezone?, shortcutNewChat?,
    shortcutCancel?, shortcutFocus? }
  → 200 { full profile }
  Validation: campus ∈ {"", "RR", "EC"}; onboardingDone bool.
  `institution` is still free-text (legacy values); D7 only constrains
  `campus`.
```

### 7.3 Chats + demo state

Unchanged from v5: keyed by Neon user id (was our `user.id` in v5,
now `neon_user_id` — same call shape, different key). All ownership
checks compare `chat.user_id` to the verified `sub`.

### 7.4 Self-service data

```http
GET /api/v1/users/me/export
→ 200 { "profile": {...}, "chats": [...], "demoState": [...],
       "exportedAt": "...", "version": 1 }
DELETE /api/v1/users/me → 204 then hard-delete cascade (profile, chats,
  demo_state, users row). Frontend then calls Neon SDK to delete the
  Neon user record.
```

## 8. Messages extension points (deferred spec)

- `messages.chat_id → chats.id ON DELETE CASCADE`, `UNIQUE(chat_id, idx)`.
- `truncateOverlay(keep)` becomes `DELETE FROM messages WHERE chat_id=? AND
  idx>=?`.
- Vote keys migrate `${sessionKey}:${blockIndex}` → `messages.id`.
- Retention enforcement lives in the messages spec as a worker.

## 9. Security baseline (v6)

- Every protected route verifies the Neon JWT against JWKS; no trust
  in frontend-supplied user id.
- EdDSA via `pyjwt[crypto]`. Required claims: `sub`, `email`, `exp`.
  Cache JWKS for 1h; on key-rotation (unknown `kid`) refetch once and
  re-verify; if the second attempt also fails, return 401.
- CORS allowlist = `FRONTEND_ORIGINS`; preflight must succeed for
  the browser to send the JWT. CORS rejection never leaks server
  detail.
- Origin/Referer check on mutating routes is dropped (we don't have
  cookie-based auth; the JWT itself is the proof).
- Rate limit: `RATE_LIMIT_LOGIN/SIGNUP` kept as legacy defaults
  (5/hr and 10/min) but unused (Neon owns login/signup rate limits).
  General API rate limiting lives in the messages spec.
- Argon2 is removed (no passwords to hash).
- No secrets logged; structured logs per request: method, path
  template, status, latency ms, neon user id hash (never email). No
  bodies.
- `alembic upgrade head` at deploy; `downgrade -1` verified in CI.

## 10. JWT verification details

```python
# app/auth/neon.py (new in v6)
import jwt
from jwt import algorithms

JWKS_TTL_SECONDS = 3600
_jwks_cache: dict[str, dict] = {}
_fetched_at: float = 0.0

def _load_jwks() -> dict[str, dict]:
    # Fetch NEON_AUTH_JWKS_URL; cache by kid; on cache miss, refetch
    # once before failing. Return map { kid: jwk }.

def verify_token(token: str) -> dict:
    headers = jwt.get_unverified_header(token)
    jwks = _load_jwks()
    kid = headers.get("kid")
    if kid not in jwks:
        _jwks_cache.clear()  # force refresh
        jwks = _load_jwks()
    pub = algorithms.Ed25519Algorithm.to_jwk(jwks[kid])  # or use PyJWK
    return jwt.decode(
        token, pub,
        algorithms=["EdDSA"],
        audience=None,  # Neon does not always set aud
        options={"require": ["sub", "email", "exp"]},
    )
```

`app/deps.py:get_current_user_from_neon`:

```python
def get_current_user_from_neon(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        return JSONResponse(401, UNAUTHORIZED)
    try:
        claims = verify_token(authorization.split(" ", 1)[1])
    except jwt.PyJWTError:
        return JSONResponse(401, UNAUTHORIZED)
    user = db.scalar(select(User).where(User.neon_user_id == claims["sub"]))
    if user is None:
        user = User(
            neon_user_id=claims["sub"],
            email=claims["email"],
            display_name=claims.get("name", "")[:80],
        )
        db.add(user)
        db.commit()
    return user
```

`app/routers/auth.py`:

```python
@router.get("/me")
def me(result=Depends(get_current_user_from_neon), db: Session = Depends(get_db)):
    if isinstance(result, JSONResponse):
        return result
    profile = db.get(Profile, result.id)  # auto-create on first read
    return {
        "user": {
            "id": str(result.id),
            "email": result.email,
            "displayName": result.display_name,
            "onboardingDone": bool(profile and profile.onboarding_done),
        }
    }

@router.post("/logout", status_code=204)
def logout():
    return Response(status_code=204)
```

## 11. Frontend integration

- `@neondatabase/neon-js` + `@neondatabase/auth-ui`. The auth client
  wraps `useNeonSession()`; `apiFetch(path, init)` injects
  `Authorization: Bearer ${session.access_token}`.
- `PUBLIC_NEON_AUTH_URL` (frontend env) is the SDK base.
- `PUBLIC_API_BASE_URL` (frontend env) is our backend base.
- No `import.meta.env.PUBLIC_USE_API` flag — auth via Neon is the
  only path. The previous local-first adapter (`USE_API`) is gone;
  the in-memory store remains as the only read path (no legacy
  import — see auth spec §H L4).

## 12. Explicitly closed gaps (no silent deferrals)

- Our app has no 2FA, no passkeys, no active-sessions UI, no
  sign-out-other, no logged-out password recovery, no email
  verification, no remember-me. All of those live in Neon.
- Delete account is split: `DELETE /users/me` removes our rows; the
  Neon user record is removed via the SDK on the frontend. Documented
  in spec §I.F4.
- Argon2 is no longer required (no passwords in our backend).
- `JWT_SECRET` is no longer required.
