# Backend foundation — auth, profiles, chat containers (messages deferred)

Status: Proposed.
Date: 2026-09-06.
Scope: separate FastAPI service + Neon Postgres covering auth/users,
profiles/preferences, and chat containers (list/rename/delete/pin/archive).
Message bodies (bubbles, toolCalls, attachments, follow-ups, votes) are
explicitly **deferred** to a dedicated messages/RAG schema pass — this doc
defines the extension points so that pass attaches without breaking anything
here. No ingestion pipeline in this slice.
Frontend UI is frozen per `AGENTS.md`; integration is a fetch adapter only.

Traceability: `frontend/src/lib/session.ts` (store seam), `frontend/src/lib/chat.ts`
(subjects/codes), `frontend/src/components/profile/sections.tsx` (profile field
contracts), `docs/audits/2026-09-06-backend-readiness-audit.md` (§1 blockers,
§5 phase 0).

## 1. Goals / non-goals

Goals:

- Real identity replaces device-keyed localStorage for auth, profiles, chats.
- `session.ts` signatures gain a 1:1 server implementation behind a
  `USE_API` flag with zero component changes.
- Neon schema is RAG-ready (pgvector enabled, subject FKs, stable chat ids)
  without creating any document/chunk/embedding tables yet.
- Every `pesdac-*` localStorage key gets an explicit fate (migrate / keep
  local / drop).

Non-goals (deferred with owner):

- Message bodies + turn history + edit/regenerate server rewrite → dedicated
  messages spec (extension points in §8).
- Turn feedback/votes server persistence → rides with messages (voteKey needs
  a message id; frontend keeps `pesdac-feedback-v1` local until then).
- Uploads (`POST /uploads`), SSE streaming, share links, quiz checking,
  context meter → their own specs per the backend-readiness audit §4.
- Ingestion pipeline, document tables, embeddings, retrieval → future RAG
  phase. `vector` extension is enabled now so that phase is `CREATE TABLE`
  only, not an ops change.

## 2. Decisions (locks the audit §1 blockers)

| # | Decision | Rationale |
|---|---|---|
| D1 | Separate API service (`backend/`, FastAPI), Astro stays static | User choice; keeps RAG in Python and avoids Astro hybrid/SSR migration. CORS + env config instead of same-origin endpoints. |
| D2 | Real auth from day one (email+password AND Google OAuth) | User choice. Device-id migration path rejected: anonymous data merge adds complexity for a study tool where login is expected. |
| D3 | Neon Postgres 16 + `vector` extension enabled at migration 0001 | User choice; pgvector present with zero vector columns so the RAG phase adds tables only. |
| D4 | Access JWT (15 min) + opaque rotating refresh token (30 d) in httpOnly cookies | Revocable sessions, no token in JS, survives the static-frontend / separate-origin shape. |
| D5 | Email verification column exists, enforcement deferred; password reset included | Verification enforcement without an email provider is a fake gate; reset is required the moment passwords exist, so it ships with pluggable email. |
| D6 | Drafts never leave the device | Matches `chat-power.md` §9 (local-only by design, no emit). No draft endpoint, ever. |
| D7 | Demo threads stay static in the frontend; only per-user overrides persist | `convo-mgmt.md`: registry is canonical, renames/hides/pins are session state. Backend stores overrides, never demo content. |
| D8 | API versioned at `/api/v1` from the first endpoint | First API is the cheapest time to version; avoids Hyrum's-law lock-in on unversioned paths. |

Per-key localStorage fate:

| Key | Fate |
|---|---|
| `pesdac-custom-chats-v1` | Migrate → `chats` (§5). One-time import, then authoritative in DB. |
| `pesdac-overlays-v1` | **Deferred with messages.** No import in this slice; stays local until messages spec lands, then bulk-imported once. |
| `pesdac-pins-v1`, `pesdac-archived-v1` | Migrate → `chats.is_pinned/is_archived` + `demo_state` (§5). |
| `pesdac-demo-overrides-v1` | Migrate → `demo_state` (§5). |
| `pesdac-profile-v1` | Migrate → `profiles` (§5). Merge-over-defaults rule preserved server-side. |
| `pesdac-feedback-v1` | Keep local until messages slice (no message ids to key on yet). |
| `pesdac-drafts-v1` | Keep local permanently. No backend. |

## 3. System shape

```text
Browser (Astro static, Astryx UI unchanged)
  │  fetch, credentials:include, Origin: FRONTEND_ORIGINS[i]
  ▼
FastAPI backend/  ──►  Neon Postgres (psycopg3 pool)
  │  GET /api/v1/health, /ready (unauthenticated, §10)
  │  Auth / profiles / chats / demo-state routers (§7)
  └── Outbound: Google OAuth tokeninfo/userinfo (Authlib), SMTP/Resend stub (reset mail)
```

No server-rendered pages, no Astro adapter change, no shared DB credentials in
the frontend. The frontend never sees the database URL, JWT secret, Google
client secret, or refresh-token hashes.

## 4. Tech stack (pinned at scaffold)

- Python 3.12, FastAPI ≥0.115, Uvicorn (dev) / Gunicorn+Uvicorn workers (prod).
- SQLAlchemy 2.0 (typed `Mapped`), Alembic migrations, Pydantic v2 schemas.
- `pwdlib[argon2]` (Argon2id) for passwords; `python-jose` or `pyjwt` for
  access JWT (HS256, 256-bit+ secret); refresh tokens are 32-byte opaque
  `secrets.token_bytes` stored as SHA-256 hash.
- `Authlib` for Google authorization-code flow.
- `slowapi`-style rate limiting (in-memory for v1, Redis hook noted, §9).
- `pytest` + `httpx` AsyncClient for contract tests.
- Neon Postgres 16. Driver `psycopg[binary,pool]`. Migration 0001 runs
  `CREATE EXTENSION IF NOT EXISTS vector;` and creates no vector columns.

Repo layout (scaffold creates this, nothing else):

```text
backend/
├── app/
│   ├── main.py            # app factory, CORS, routers, /health, /ready
│   ├── config.py          # env loading + validation at startup (§6)
│   ├── deps.py            # DB session, current_user, origin check
│   ├── security.py        # argon2, JWT, refresh hashing, code gen
│   ├── rate_limit.py      # login/signup/reset limits
│   ├── models/            # users, profiles, chats, demo_state, tokens
│   ├── schemas/           # Pydantic in/out per §7
│   └── routers/           # auth, profiles, chats, demo_state, export
├── alembic/ + alembic.ini
├── tests/                 # contract tests per router
├── pyproject.toml
└── .env.example
```

## 5. Database schema (v1 DDL — complete, no message tables)

Conventions: UUID PKs (`gen_random_uuid()`), `timestamptz` UTC everywhere,
`updated_at` maintained by app (no triggers in v1 to keep Neon diffs trivial),
all user-owned rows carry `user_id ... REFERENCES users(id) ON DELETE CASCADE`
so delete-account is one `DELETE FROM users`. Every list query is scoped by
`user_id` — there is no cross-user read path.

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,          -- citext needs extension; else text + lower() unique index
  password_hash text NULL,                        -- NULL for Google-only accounts
  display_name  text NOT NULL DEFAULT '',
  email_verified_at timestamptz NULL,             -- set by future verify flow; unenforced in v1 (D5)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_format CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

CREATE TABLE oauth_accounts (
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     text NOT NULL DEFAULT 'google',
  provider_sub text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_sub),
  UNIQUE (user_id, provider)
);

CREATE TABLE refresh_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,                -- SHA-256 hex of opaque token
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,                -- +60 min
  used_at    timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subjects (
  code         text PRIMARY KEY,                  -- CN | OS | DLCD | DSA | Math
  display_name text NOT NULL
);
-- Seed: ('CN','Computer Networks'), ('OS','Operating Systems'),
-- ('DLCD','Digital Logic'), ('DSA','Data Structures'), ('Math','Mathematics')
-- Matches SUBJECT_NAMES in frontend/src/lib/chat.ts:13-20.

CREATE TABLE profiles (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name    text NOT NULL DEFAULT '',
  email           text NOT NULL DEFAULT '',       -- contact copy; auth email stays users.email
  institution     text NOT NULL DEFAULT '',
  semester        text NOT NULL DEFAULT '',       -- '1'..'8' or '' (Selector hasClear)
  branch          text NOT NULL DEFAULT '',       -- CSE|ECE|EEE|ME|CE|BT|Other or ''
  subjects        text[] NOT NULL DEFAULT '{}',   -- enrolled subjects, subset of subjects.code
  exam_month      text NOT NULL DEFAULT '',       -- free text, e.g. 'December 2026'
  weekly_goal     text NOT NULL DEFAULT '5 days', -- 3 days | 5 days | 7 days
  difficulty      text NOT NULL DEFAULT 'medium', -- easy | medium | hard
  depth           text NOT NULL DEFAULT 'auto',   -- auto | ask | deep
  verbosity       text NOT NULL DEFAULT 'balanced', -- concise | balanced | thorough
  proactive_quiz  boolean NOT NULL DEFAULT true,
  follow_ups      boolean NOT NULL DEFAULT true,
  citations       text NOT NULL DEFAULT 'on request', -- always | on request
  retention       text NOT NULL DEFAULT 'forever',    -- forever | 1 year | 30 days | session
  language        text NOT NULL DEFAULT 'en-US',
  region          text NOT NULL DEFAULT 'IN',
  timezone        text NOT NULL DEFAULT 'IST',
  shortcut_new_chat boolean NOT NULL DEFAULT true,
  shortcut_cancel   boolean NOT NULL DEFAULT true,
  shortcut_focus    boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_weekly_goal CHECK (weekly_goal IN ('3 days','5 days','7 days')),
  CONSTRAINT profiles_difficulty CHECK (difficulty IN ('easy','medium','hard')),
  CONSTRAINT profiles_depth CHECK (depth IN ('auto','ask','deep')),
  CONSTRAINT profiles_verbosity CHECK (verbosity IN ('concise','balanced','thorough')),
  CONSTRAINT profiles_citations CHECK (citations IN ('always','on request')),
  CONSTRAINT profiles_retention CHECK (retention IN ('forever','1 year','30 days','session'))
);
-- Allowed language/region/timezone values are the exact option lists in
-- sections.tsx (LANGUAGES/REGIONS/TIMEZONES); enforced in Pydantic (§7),
-- not CHECK constraints, so adding a locale is a code change, not a migration.
-- semester/branch validated in Pydantic against SEMESTERS/BRANCHES; '' allowed.

CREATE TABLE chats (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code        text NOT NULL UNIQUE,               -- 6-char [a-z0-9], URL identity, never reused
  subject     text NOT NULL REFERENCES subjects(code),
  title       text NOT NULL,                      -- trimmed, 1..34 chars (matches session.ts slice)
  is_pinned   boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chats_code_format CHECK (code ~ '^[a-z0-9]{6}$'),
  CONSTRAINT chats_title_len CHECK (char_length(title) BETWEEN 1 AND 34)
);
CREATE INDEX ON chats (user_id, is_archived, is_pinned, updated_at DESC);
-- code is globally unique (simplest correct; ownership still enforced per-row).
-- Server reserves all 20 CHAT_CODES values from lib/chat.ts plus TAKEN demo
-- codes at insert time and returns 409 on collision (retry with a new code).

CREATE TABLE demo_state (
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  demo_label    text NOT NULL,                    -- canonical label, e.g. 'TCP vs UDP'
  display_title text NULL,                        -- NULL = registry default
  is_hidden     boolean NOT NULL DEFAULT false,   -- archive/hide for demos
  is_pinned     boolean NOT NULL DEFAULT false,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, demo_label)
);
-- demo_label validated against the 20 CHAT_CODES keys; unknown → 422.
-- Archiving a demo sets is_hidden=true (matches convo-mgmt.md: demo Delete
-- archives). display_title mirrors renameDemoChat (trim, 1..34, NULL clears).
```

Explicitly NOT created in this slice (reserved names the messages spec must
use): `messages(chat_id FK → chats.id, idx, role, bubbles jsonb, ...)`,
`turn_feedback`, `uploads`, `documents`, `chunks`, `embeddings`. The messages
spec owns those names; nothing here may claim them.

Indexes cover the only v1 access patterns (per-user chat lists, token
lookups). No vector index yet — nothing to index.

## 6. Configuration (fail-fast at startup)

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon pooled URL, `sslmode=require`. App refuses to boot without it. |
| `JWT_SECRET` | yes | ≥32 bytes. Boot fails if missing/short. |
| `ACCESS_TTL_MIN` | no | Default 15. |
| `REFRESH_TTL_DAYS` | no | Default 30. |
| `FRONTEND_ORIGINS` | yes | Comma-separated allowlist (e.g. `http://localhost:4321,https://pesdac.app`). CORS + cookie scope derive from this. Empty = boot failure. |
| `COOKIE_SECURE` | no | Default true; false only for `http://localhost` dev. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | yes for OAuth | Missing = `/auth/google/*` returns 501 with `OAUTH_NOT_CONFIGURED`, email auth unaffected. |
| `RESET_MAIL_FROM` / `RESEND_API_KEY` or `SMTP_URL` | no | Missing = reset tokens are created but mail send is logged-only; `POST /auth/password/request` still returns 202 (no account-oracle, §9). |
| `RATE_LIMIT_LOGIN`, `RATE_LIMIT_SIGNUP` | no | Defaults §9. |

`.env.example` documents all of the above. No other env is read. `import.meta.env`
usage in the frontend is limited to `PUBLIC_API_BASE_URL` + `PUBLIC_USE_API`
(see §11) — no secret ever gets a `PUBLIC_` prefix.

## 7. API contract (`/api/v1`, JSON, error envelope §9)

Auth model for every endpoint below: `auth: none | access-cookie`.
Cookies: `pesdac_at` (access JWT), `pesdac_rt` (opaque refresh). Frontend sends
`credentials: "include"`; JS never reads either cookie.

### 7.1 Auth

```http
POST /api/v1/auth/signup
{ "email": "you@example.com", "password": "...", "displayName": "Your name" }
→ 201 { "user": { "id": "...", "email": "...", "displayName": "..." } }
+ Set-Cookie pesdac_at, pesdac_rt. 409 EMAIL_TAKEN. 422 validation.
```

```http
POST /api/v1/auth/login
{ "email": "...", "password": "..." }
→ 200 { "user": {...} } + cookies. 401 INVALID_CREDENTIALS (same for
unknown email — no oracle).
```

```http
POST /api/v1/auth/refresh → 200 {} + rotated cookies. 401 when missing/
expired/revoked. Rotation: old refresh hash revoked, new row issued.
POST /api/v1/auth/logout  → 200 {} + cleared cookies + revoke calling refresh.
GET  /api/v1/auth/me      → 200 { "user": {...}, "profile": {...}|null } | 401.
```

Google OAuth (authorization-code, server-side exchange):

```http
GET /api/v1/auth/google/start?next=/new
→ 302 Google consent (state cookie `pesdac_oauth_state`, 10 min, next validated
  against FRONTEND_ORIGINS-relative paths only, default /new).
GET /api/v1/auth/google/callback?code=...&state=...
→ new user? create users row (password_hash NULL) + oauth_accounts row +
  blank profiles row; returning? link oauth_accounts if email matches.
→ 302 {FRONTEND_ORIGIN}/new + cookies. Failures → 302 {origin}/login?error=oauth_failed (no stack leak).
```

Password reset (ships in v1 because passwords ship in v1):

```http
POST /api/v1/auth/password/request { "email": "..." }
→ always 202 {} (creates password_reset_tokens row + mails link if account
  exists; identical response otherwise).
POST /api/v1/auth/password/confirm { "token": "...", "newPassword": "..." }
→ 200 {} (single-use: used_at set; all refresh_tokens for the user revoked).
  Expired/used/unknown → 400 INVALID_TOKEN (same message for all three).
```

Validation: email RFC-length ≤254 + regex (§5); password 12..128 chars (long
minimum is deliberate: study tool, no 2FA in v1); displayName trim, ≤80 chars,
may be empty (blank identity is the current mockup seed).

### 7.2 Profiles

`GET /api/v1/profiles/me → 200 {profile}` — auto-creates the blank
`DEFAULT_PROFILE` row (values in §5 = `DEFAULT_PROFILE` in session.ts:428-450)
on first read so signup needs no extra write.

```http
PATCH /api/v1/profiles/me
{ "displayName": "Aarav", "difficulty": "hard", "proactiveQuiz": false }
→ 200 {profile} (full row back). Unknown keys → 422. Merge-over-defaults:
   response is always complete; older clients missing new keys still validate.
```

Field rules mirror the UI exactly: semester `''|1..8`; branch
`''|CSE|ECE|EEE|ME|CE|BT|Other`; subjects ⊆ subject codes; language/region/
timezone ⊆ sections.tsx option values; weeklyGoal/difficulty/depth/verbosity/
citations/retention ⊆ §5 CHECK sets; text fields trimmed, ≤120 chars except
displayName ≤80; booleans strict. `email` here is contact copy (may differ
from login email); changing login email is NOT in v1 (explicit gap closure —
see §12).

### 7.3 Chats (containers only — no message bodies)

```http
GET /api/v1/chats?archived=false&limit=50&offset=0&subject=CN&q=tcp
→ 200 { "data": [{ "code":"x7k2m9","subject":"CN","title":"TCP vs UDP",
     "isPinned":false,"isArchived":false,"createdAt":"...","updatedAt":"..." }],
     "pagination": { "limit":50,"offset":0,"total":12 } }
  Order: pinned first, then updatedAt DESC (matches sidebar Pinned section).
  archived default false; q is case-insensitive substring on title (mirrors
  sidebar search). limit 1..100 default 50.

POST /api/v1/chats { "subject":"CN", "title":"  OSI model  " }
→ 201 {chat} (server generates code, reserves demo codes, trims to 34).
  Unknown subject → 422. Empty-after-trim title → 422 (frontend falls back
  to "New chat" locally; server rejects rather than inventing names).

PATCH /api/v1/chats/{code} { "title":"..." } | { "isPinned":bool } | { "isArchived":bool }
→ 200 {chat}. Cross-user code → 404 (never 403 — no existence oracle).
  Archive sets isArchived=true AND isPinned=false (matches archiveChat).
  Unarchive sets isArchived=false. Title rules = POST.

DELETE /api/v1/chats/{code} → 204 (deletes the container; messages don't exist
  yet so nothing else to cascade in v1). Opening-chat-exit navigation stays
  frontend behavior. Cross-user → 404.
DELETE /api/v1/chats (clear-all, mirrors clearAllChats)
→ 200 { "deleted": 14 }. Deletes only chats. Profile + demo_state + votes kept.
```

### 7.4 Demo overrides

```http
GET /api/v1/demo-state → 200 { "overrides": [{ "demoLabel":"TCP vs UDP",
  "displayTitle":null,"isHidden":false,"isPinned":false }] } (only rows set).
PUT /api/v1/demo-state/{label} { "displayTitle":"...", "isHidden":bool, "isPinned":bool }
→ 200 {override}. Partial body allowed; displayTitle null/"" clears to registry
  default. Unknown label → 422. Hidden+open-chat exit stays frontend.
```

### 7.5 Self-service data (preserves Privacy section behavior)

```http
GET /api/v1/users/me/export
→ 200 { "profile":{...}, "chats":[...], "demoState":[...],
       "exportedAt":"...", "version":1 }
  Replaces exportAllData for logged-in users (DB source, not localStorage).
  Votes/drafts are absent by design (still local) — the payload documents
  that so users don't report "missing" data.
DELETE /api/v1/users/me → 202 {} then hard-delete cascade (profile, chats,
  demo_state, tokens). Auth cookies cleared. Google link rows cascade.
  Retention 'session' maps to: logout revokes refresh + frontend clears view;
  server has nothing extra to purge until messages exist (§12).
```

## 8. Messages extension points (what the deferred spec must plug into)

- `messages.chat_id → chats.id ON DELETE CASCADE`, `UNIQUE(chat_id, idx)`.
  `chats.code` stays the URL identity; message ids never appear in routes
  until the share-links spec says so.
- `truncateOverlay(keep)` becomes `DELETE FROM messages WHERE chat_id=? AND
  idx>=?` — the v1 `updated_at` on chats already bumps on every such write.
- Vote keys migrate `${sessionKey}:${blockIndex}` → `messages.id` with a
  one-time backfill from `pesdac-feedback-v1`; the `turn_feedback` name is
  reserved for that spec.
- Retention enforcement lives in the messages spec as a worker: forever =
  no-op; `1 year`/`30 days` = `DELETE FROM chats WHERE updated_at < now()-window`
  (cascade wipes messages); `session` = delete on logout. Storing the pref
  now means that worker needs no schema change.

## 9. Cross-cutting rules

Errors — one envelope, no stack leaks:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Title must be 1–34 characters." } }
```

Codes: `VALIDATION_ERROR(422)`, `UNAUTHORIZED(401)`, `NOT_FOUND(404)`,
`CONFLICT(409: EMAIL_TAKEN, CODE_COLLISION-retry)`, `RATE_LIMITED(429)`,
`OAUTH_NOT_CONFIGURED(501)`, `INTERNAL(500: "Something went wrong.")`.
Auth failures never distinguish unknown-email from wrong-password.

Validation at the boundary (Pydantic schemas per router); internal service
code trusts types. Third-party payloads (Google userinfo) are validated as
untrusted input before any link/create decision.

Ownership: every chats/demo_state/profiles query includes `user_id =
current_user.id`. `getChatByCode`-style lookups are `(code, user_id)` — a
user guessing another user's code gets 404.

Rate limits (v1, per-IP + per-route): signup 5/hr, login 10/min,
password/request 5/hr, password/confirm 10/hr, refresh 30/min, Google start
30/min. Exceed → 429 with `Retry-After`. Abuse-prone and auth endpoints only;
profiles/chats/demo-state rely on auth + ownership (no global throttle).

Cookies: `HttpOnly; Path=/; SameSite=Lax; Secure` (Secure=false only when the
API origin is `http://localhost`). No `Domain` set. Access 15 min, refresh
30 d. CSRF: SameSite=Lax + strict Origin/Referer allowlist check on all
mutating routes (returns 403 on mismatch); no separate CSRF token in v1 —
documented tradeoff, sufficient for a first-party study app, revisited if
third-party form posts ever need to hit the API.

Transport: HTTPS enforced in prod ( weaknesses: `COOKIE_SECURE=false` boots
only when every FRONTEND_ORIGIN is localhost — else boot failure). Security
headers on all responses: `nosniff`, `DENY` frame, strict referrer. Secrets
never logged; reset/OAuth tokens logged as `[redacted]`.

Markdown/XSS note (from readiness audit §2.1): no user text is rendered as
markdown by this slice (profiles/titles are plain-text UI). The messages spec
must resolve the Astryx `Markdown` sanitization question before echoing any
stored user text — recorded here so it isn't lost.

## 10. Observability

- `GET /api/v1/health` (liveness, no DB): `200 {"ok":true}`.
- `GET /api/v1/ready` (DB pool check): 200/503.
- Structured JSON logs per request: method, path template (never raw code
  values), status, latency ms, user id hash (never email). No bodies.
- Alembic `upgrade head` runs at deploy; `downgrade -1` verified in CI for
  every migration in this doc.

## 11. Frontend integration (no UI changes)

New file `frontend/src/lib/api.ts` implements the `session.ts` signatures over
fetch (`listCustomChats`, `createCustomChat`, `renameCustomChat`,
`deleteCustomChat`, `togglePin`, `archiveChat`, `unarchiveChat`,
`getProfile`, `updateProfile`, `clearAllChats`, demo overrides) plus the
one-time localStorage import. `PUBLIC_API_BASE_URL` + `PUBLIC_USE_API`
(default off) are the only new env. SSR-safe: server renders empty (as today);
after mount, `USE_API=true` swaps reads to the API with localStorage as
offline fallback for the deferred keys only (overlays/votes/drafts). Acceptance
test for the slice: `USE_API` on/off produces identical sidebar/Profile
behavior with zero component diffs.

Migration UX: first login with `USE_API` shows one inline notice ("Imported N
chats and preferences — your old device data stays in this browser until you
clear it") and never auto-deletes local keys.

## 12. Explicitly closed gaps (no silent deferrals)

- Change-login-email, delete-unverified-accounts job, 2FA, notification
  prefs, avatar upload, username login → OUT of v1, no columns reserved
  except `email_verified_at` (future verify flow needs no migration).
- `email` inside profiles is display/contact copy; `users.email` is identity.
  They intentionally diverge; a future change-email flow syncs both.
- Language/region/timezone/retention/verbosity/citations/difficulty are
  stored-only in v1 (frontend already labels them as such) — binding them to
  RAG behavior belongs to the messages/RAG specs.
- Subjects are closed to the 5 seeded codes; adding a subject is a seeded
  migration + frontend `SUBJECTS` change together, never one side alone.

## 13. Verification (scaffold must prove)

- `pytest` contract tests: signup→me→patch-profile→create-chat→rename→
  pin→archive→unarchive→delete→export→delete-account; cross-user 404s;
  demo-override round-trip; refresh rotation + reuse detection (reuse revokes
  the whole token family); reset request/confirm + single-use.
- `alembic upgrade head` + `downgrade -1` + `upgrade head` green on a clean
  Neon branch.
- `tsc` + `astro build` unaffected (frontend diff is additive `api.ts` only).
- Manual: Google OAuth round-trip on staging; 360px Profile dialog against
  live API; throttled-login 429 check.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Code collisions with demo codes | Server-side reservation + 409-retry; property test over `genCode`. |
| Cookie + separate-origin surprises (Safari ITP) | Lax + credentials:include verified on staging Safari before calling auth done. |
| citext unavailable on Neon branch | Fallback: `text` + `UNIQUE (lower(email))`; scaffold tries citext, falls back automatically. |
| Scope creep pulling messages back in | This doc's §8 is the contract; messages spec must not alter any table defined here except adding FKs to `chats.id`. |
