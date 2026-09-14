# PESDac — Study Assistant

Astro + React (Astryx UI) frontend, FastAPI backend, BetterAuth
identity, one shared Neon Postgres database. Guests meet a login gate;
authenticated users get server-backed chats, profiles, and settings.

## Setup

Requirements: Node 24+, Python 3.12+, Postgres 16 (Neon or local).

```powershell
# 1. Environment (names-only templates — never commit .env)
Copy-Item .env.example .env  # drizzle/identity vars, if needed
Copy-Item frontend/.env.example frontend/.env
Copy-Item backend/.env.example backend/.env
# Fill in: DATABASE_URL, BETTER_AUTH_URL/SECRET (32+ chars),
# FRONTEND_ORIGINS, GOOGLE_* — see docs/operations/env-parity.md

# 2. Install
npm install            # root: identity-schema toolchain only
npm --prefix frontend install
pip install -e backend/.[test]

# 3. Migrate
npm run db:push                                              # identity tables (Drizzle)
cd backend && alembic upgrade head && cd ..                  # app tables (Alembic)

# 4. Run both dev servers
npm --prefix frontend run dev    # http://localhost:4321
cd backend && python serve.py    # http://127.0.0.1:8000 (validated boot)
```

## Verify

```powershell
npm --prefix frontend run test      # frontend unit (node --test)
python -m pytest                    # from backend/
npm --prefix frontend run test:e2e  # origin-pinned build + Playwright smoke + axe
npm --prefix frontend run bundle:check  # after a build
python scripts/check_secrets.py     # secret scan (has --self-test)
```

Static gates on every change: unit tests, `astro check` (0 errors),
`astro build`, full pytest, `git diff --check`, secret scan.
Browser/provider/measurement follow-ups need staging + credentials
(the authed Playwright matrix is `test.fixme` until then).

## Stale dev assets?

Hard-refresh first. Then restart both dev servers (`optimizeDeps.force`
rebuilds the dev cache). Still red → `docs/operations/stale-recovery.md`.

## Map

- Product/architecture truth: `docs/architecture/`, `docs/design/`
- Decisions: `docs/decisions/` (ADRs, sequential)
- Runbooks: `docs/operations/` (deploy, rollback, env, orphans, purge)
- Audits: `docs/audits/` (append-only) + `docs/audits/security/`
- API contract: `docs/API.md`
- Execution artifacts (not truth): `docs/reasonix/specs|plans/`
- Lessons: `LESSONS.md` (repo root)
- Agent rules: `AGENTS.md` (UI source of truth), `CLAUDE.md` (pipeline)
