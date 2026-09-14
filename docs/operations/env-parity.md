# Environment parity (audit §19)

## Who runs what from where (explicit no-workspaces, §19 decision)

Three runtimes, no npm workspaces (a workspace would imply one
toolchain — this repo has three). Commands always run from the
directory named:

| From | Runs | Examples |
|---|---|---|
| repo root | identity-schema toolchain only (BetterAuth/Drizzle CLI) | `npm run db:generate`, `npm run db:push`, `npm test` (= frontend unit suite) |
| `frontend/` | Astro app: dev/build/preview/unit/e2e/bundle | `npm run dev`, `npm test`, `npm run test:e2e`, `npm run bundle:check` |
| `backend/` | FastAPI: tests, migrations, scripts | `python -m pytest`, `alembic upgrade head`, `python scripts/check_orphans.py` |

Backend tests never run from the root (`python -m pytest` resolves the
`app` package from `backend/`). CI (§20) runs all three rows.

## Required vars per environment

Backend (`backend/.env.example` is names-only): `ENV`
(dev/staging/prod/test), `DATABASE_URL` (+ optional pooled
`DATABASE_URL_POOLED` — app traffic prefers pooled, migrations use
direct), `FRONTEND_ORIGINS` (every origin: dev port, preview URLs,
prod domain — empty = boot failure), `BETTER_AUTH_URL`,
`BETTER_AUTH_SECRET` (32+ chars), `COOKIE_SECURE` (default true).
Prod additionally requires: https-only origins, `COOKIE_SECURE=true`,
`LLM_KEY_ENCRYPTION_KEY` (32+). Optional: `UPSTASH_*` (unset =
NullCache), `TRUSTED_PROXY_HOSTS` (unset = never trust XFF),
`BETTER_AUTH_AUDIENCE` (unset = accept absent aud).

Frontend (baked at BUILD time): `PUBLIC_API_BASE_URL` (host only —
`lib/auth.ts` appends `/api/v1`), `PUBLIC_BETTER_AUTH_URL`. Exactly
these two ever reach the browser; no secret ever gets `PUBLIC_`
(reconciled §19: the stale `PUBLIC_NEON_AUTH_URL` in pre-migration
docs is dead — code + `env.d.ts` + canonical arch doc agree).

## Alignment notes

- `GOOGLE_CLIENT_ID`: localhost callback for dev, prod domain for
  prod (Google console allowlists must match the serving origin —
  same class of bug as the e2e origin pin in §13).
- BetterAuth trusted origins/proxies: the Astro `lib/auth.ts` client
  and `BETTER_AUTH_TRUSTED_ORIGINS/PROXIES` (when set) must list the
  same origins as `FRONTEND_ORIGINS`, or preflight/session fetches
  fail by design. Backend `TRUSTED_PROXY_HOSTS` is the separate
  rate-limit IP-trust list (exact-match CIDR/host strings).
- `COOKIE_SECURE` matrix: dev http + false allowed; any https origin
  + false is a boot error; prod forces true.

## Keys (mint / custodian / rotation)

- `BETTER_AUTH_SECRET`: 32+ chars, host secrets manager, rotation =
  re-login wave (old sessions stop verifying — safe failure).
- `LLM_KEY_ENCRYPTION_KEY` (Fernet): mint with
  `python -c "from cryptography.fernet import Fernet;
  print(Fernet.generate_key().decode())"`. Custodian: whoever deploys
  prod. Rotation orphans stored `llm_credentials` rows (no
  re-encryption path — we never hold plaintext); users re-save in
  Settings. Full procedure: `docs/operations/env-rotation.md`.
