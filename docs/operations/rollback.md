# Rollback (audit §17)

## Backend migrations

Every migration has a `downgrade()` (pinned by
`test_migration_chain.py`). To step back one:

1. `cd backend && alembic downgrade -1` (repeat per step; the
   0002→0001 path is the documented anchor).
2. Redeploy the previous code image AFTER the downgrade lands.

Warnings (both documented in the migrations themselves):

- `0003_neon_auth_link` downgrade DROPS the v6 `users` table and
  restores v5 tables — rows created after the upgrade are NOT
  recoverable. Downgrading across 0003 is data loss by design; prefer
  rolling forward.
- Prod index builds go out-of-band with `CREATE INDEX CONCURRENTLY`,
  then the migration is stamped (see 0007 + ADR-0004) — never run a
  locking build inside `upgrade()` on prod data.

## Frontend

Stateless output (`dist/`): redeploy the previous good build. No
migrations, no rollback state. Mixed-build symptoms (new HTML + old
`_astro/*` 404s) mean the CDN/worker served two builds at once —
redeploy cleanly, then hard-refresh.

## What "rolled back" means for verification

After any rollback: `/health` 200, `/ready` 200, one authed
`/auth/me` 200, and the e2e smoke (`npm run test:e2e`) green before
declaring recovery. Incidents get a LESSONS.md entry (see repo root).
