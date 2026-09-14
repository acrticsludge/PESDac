# Deploy (audit §17)

Current shape (pre-§20 pipeline — all steps manual, in this order).

## Backend (FastAPI)

1. `cd backend && alembic upgrade head` against the deploy database.
   The chain is linear to `0010_llm_credentials`, every migration
   reversible (`test_migration_chain.py`). If it fails: STOP, do not
   boot the new code — see `rollback.md`.
2. Boot with required env (`ENV`, `DATABASE_URL`, `FRONTEND_ORIGINS`,
   `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` 32+ chars, `COOKIE_SECURE=true`
   + https origins for prod). Missing/invalid config fails fast at
   startup (`config.validate_startup`) — a boot that exits here is a
   config error, not a code error.
3. Warmup runs at startup (DB `SELECT 1` + JWKS prefetch + cache probe,
   failure-tolerant). "Startup complete" means ready.
4. Smoke: `GET /health` → `{"ok":true}` (no DB); `GET /ready` → 200
   (DB). A 503 `UNHEALTHY` envelope means the database is unreachable.
5. Watch one timing line per request (`pesdac.timing`):
   `METHOD template status total_ms db_ms db_queries cache`. `cache=OFF`
   everywhere + no `UPSTASH_*` means the cache backend is unset (normal
   without Redis; reads stay correct via `NullCache`).

## Frontend (Astro SSR, Node standalone)

1. `cd frontend && npm run build` (fails on type errors — `astro check`
   is part of the gate, not optional).
2. Serve `dist/` with the Node adapter. `PUBLIC_*` values bake at BUILD
   time — a wrong-origin build (e.g. session host mismatch) needs a
   rebuild, not a restart. The e2e build pins
   `PUBLIC_BETTER_AUTH_URL` to its own origin for exactly this reason.
3. Smoke (no backend needed): `/new` shows the login gate with zero
   console errors; `/login`, `/signup`, unknown path → honest 404.
   With backend: authed `/auth/me` returns the user.
4. Stale-asset recovery: `optimizeDeps.force` is a dev-cache guard with
   zero production impact. Versioned `_astro/*` URLs that 404 after a
   deploy mean a stale CDN/worker serving old HTML — hard-reload; if it
   persists, the deploy served mixed builds (redeploy cleanly).

## Preview URLs

Every preview origin must be added to `FRONTEND_ORIGINS` + BetterAuth
trusted origins + the OAuth callback allowlist, or previews fail
preflight/auth by design. Checklist step, not tribal knowledge.

## Pipeline gates (CI, `.github/workflows/ci.yml`)

Shipping is `what changed / how verified / how monitored / how rolled
back` on every deploy: frontend unit + `astro check` + e2e smoke +
bundle caps + `npm audit` (critical) + secret scan; backend full
`pytest` + migration up/down/up on disposable Postgres 16 + `pip-audit`
+ secret scan; `git diff --check` everywhere. Staging adds the authed
smoke (`/auth/me` with a real JWT) the guest net cannot cover. A red
gate blocks the deploy — rollback (`rollback.md`) is the understood
reverse path.
