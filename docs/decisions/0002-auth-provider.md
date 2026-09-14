# ADR 0002: Self-hosted BetterAuth is the auth surface; Neon is database-only

## Status
Accepted (2026-09-14). Supersedes the v6 Neon-Auth direction (`docs/reasonix/plans/login-auth-surface.md`: `NEON_AUTH_JWKS_URL`, `app/auth/neon.py`, `@neondatabase/auth-ui`) and the Neon-Auth portions of `docs/architecture/backend-foundation-auth-profiles-chats.md` (§§1–2, 5–7, 10–11). The v5 self-implemented auth (argon2, opaque refresh tokens, Authlib exchange — arch §5) remains history, not an option.

## Date
2026-09-14

## Context
Two docs describe an auth system that is not the one in the tree:
- The v6 plan wires Neon-managed auth: `NEON_AUTH_BASE_URL` / `NEON_AUTH_JWKS_URL`, Ed25519 verification in a new `app/auth/neon.py`, `@neondatabase/auth-ui` `<AuthView>` in Astryx chrome.
- The tree runs self-hosted BetterAuth: server config in `lib/auth.ts` (secret validation, Google credentials, trusted origins/proxies, rate limits), browser client in `lib/auth-client.ts`, Drizzle schema in `lib/db/schema.ts`, same-origin handler at `frontend/src/pages/api/auth/[...slug].ts`. The backend verifies BetterAuth JWTs (`backend/app/auth/betterauth.py`) against `BETTER_AUTH_URL` / `BETTER_AUTH_SECRET` (32-char floor, fail-fast in `backend/app/config.py:115-149`). `config.py:3-6` states it plainly: "Neon Auth was removed; Neon is now database-only."
- Identity keying: `backend/app/models/users.py:28-30` stores the verified `sub` claim in `users.auth_user_id` (unique, non-null); every protected route keys ownership off the verified claims, never a frontend-supplied id. (Naming note: the arch doc calls this key `neon_user_id` — stale name for the same column concept; the column is provider-neutral `auth_user_id` and stays.)
- Password linking runs in-process, same-origin (`frontend/src/pages/api/link-password.ts:13-42` calling `auth.api.setPassword`) because BetterAuth's server-only API has no HTTP path — the old backend-proxy design could only ever 404.

## Decision
Self-hosted BetterAuth owns identity (email+password, Google OAuth, 2FA, sessions, password flows). Our FastAPI backend is a stateless JWT verifier + resource owner keyed by the verified BetterAuth `sub`. Neon provides Postgres only. No password / session / OAuth tables in our backend; no auth re-implementation anywhere else.

## Alternatives Considered

### Neon-managed auth (v6 plan as written)
- Pros: zero auth hosting, managed email flows.
- Cons: session cookie lives on Neon's origin (unshared with our API, forcing Bearer plumbing anyway), provider coupling for the product's most critical surface, and the tree has already been migrated away — re-adopting means deleting working BetterAuth config, schema, and the in-process link-password route.
- Rejected: the migration already happened in the opposite direction; docs were not updated.

### v5 self-implemented auth (argon2, opaque tokens, Authlib)
- Pros: full control.
- Cons: re-implementing passwords, OAuth exchange, 2FA, and session revocation that BetterAuth already ships — the exact mistake the v6 rework correctly identified, independent of provider.
- Rejected (again): provider changed, reasoning stands.

## Consequences
- `BETTER_AUTH_URL` / `BETTER_AUTH_SECRET` / `BETTER_AUTH_TRUSTED_ORIGINS` / `BETTER_AUTH_TRUSTED_PROXIES` + `GOOGLE_CLIENT_ID/SECRET` are required deploy configuration; `FRONTEND_ORIGINS` must list every frontend origin (dev, preview, prod).
- `docs/reasonix/specs/login-signup.md` (v6) still speaks Neon in places — it needs a BetterAuth reconciliation pass as part of §3 (auth flows) work, not here.
- `NEON_AUTH_*` variables must never be reintroduced without a new ADR; the v6 plan and Neon-rework audit are kept as history (status banners, not deletions).
- Google OAuth E2E, session-revocation semantics, and the deletion ordering contract remain open verification items (§§3–5 of the non-LLM audit) — unchanged by this ADR.
