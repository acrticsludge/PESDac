# ADR 0004: Dual-ORM ownership on one shared Neon database

## Status
Accepted (2026-09-14).

## Date
2026-09-14

## Context
The non-LLM audit (§7 item 5) asked for the dual-ORM ownership to be
written down: BetterAuth identity tables are Drizzle-managed
(`lib/db/schema.ts` + `lib/db/migrations/`), app tables are
SQLAlchemy-managed (`backend/app/models/*` + `backend/alembic/*`), and
both halves live in one shared Neon Postgres database. Without a
written rule, a future change will put a cross-ORM foreign key,
migration, or write in the wrong half.

## Decision
- **Drizzle owns identity, and only identity**: `user`, `session`,
  `account`, `verification`, `two_factor`, `jwks`, `passkey`
  (`lib/db/schema.ts:10-108`). Migrated with drizzle-kit into
  `lib/db/migrations/`. Application code treats these tables as
  read-only by convention — the one exception is the orphan check,
  which reads `"user".id` and nothing else (`backend/app/orphans.py`).
- **Alembic owns app data, and only app data**: `users`, `profiles`,
  `chats`, `messages`, `demo_state`, `subjects`, `llm_credentials`
  (chain `0001_foundation` → `0010_llm_credentials`, verified linear,
  single head, every migration reversible — `test_migration_chain.py`).
  BetterAuth never writes these tables.
- **The halves join by value, never by DDL**: `users.auth_user_id`
  equals BetterAuth `"user".id` (the verified `sub`). Verified
  2026-09-14: no Alembic migration references the `"user"` table and
  no Drizzle table references an app table — there is no cross-ORM
  foreign key in either direction, so the two migration tools run
  independently in any order.
- **One source of truth per table**: a table is created, altered, and
  dropped by exactly one tool. If a future feature needs identity-adjacent
  app data (e.g. an app-side preference keyed by user), it goes in an
  app table keyed by `users.id`, never as a column on `"user"`.
- **Deletion is one-directional by design** (`routers/users.py:67-83`,
  proven by `test_account_delete_cascade.py`): deleting the app user
  cascades profile, chats (+messages), demo-state, and LLM credentials
  via ORM `delete-orphan` plus DB `ON DELETE CASCADE` on every child
  FK. BetterAuth identity rows are NOT touched — the delete-account
  contract deletes backend first, identity second, and the transient
  gap (identity without app row) self-heals on next login via the
  `/auth/me` upsert.

## Alternatives Considered

### One ORM for everything (move identity into Alembic)
- Pros: single migration tool, enforceable FKs across the boundary.
- Cons: BetterAuth owns its schema (the drizzle-adapter + plugins
  expect their tables); hand-maintaining that schema in Alembic means
  tracking every upstream BetterAuth schema change by hand.
- Rejected: adapter-owned tables stay adapter-managed.

### Cross-ORM foreign keys (app FK → `"user".id`)
- Pros: the database enforces the join.
- Cons: couples the two migration tools' ordering, breaks Drizzle's
  ownership of its tables, and makes `downgrade` chains span tools.
- Rejected: the join is by verified claim value, checked at request
  time (`get_current_user`), with the orphan check as the audit trail.

## Consequences
- **Index inventory (verified 2026-09-14, migrations are the record)**:
  `ix_chats_user_code`, `ix_chats_user_created`,
  `ix_chats_user_subject`, `ix_profiles_retention` (perf slice),
  `ix_llm_credentials_user_id` (0010), `ix_users_auth_user_id`
  (unique; renamed from `neon_user_id` by 0005, index rename included),
  `ix_users_email_lower` (unique), `ix_chats_user_updated` +
  `ix_chats_title_trgm` (0007; the trgm/GIN options render on Postgres
  only — models declare the same name so metadata matches),
  `ix_messages_chat_seq` + `uq_messages_chat_seq` (0006),
  `uq_chats_user_adopt_key` (0008), per-chat client-key unique
  (msg-key slice), `ix_chats_user_list` (0001, superseded by 0007's
  ordering on existing deploys). The v5 auth-side tables
  (`refresh_tokens`, `oauth_accounts`, `password_reset_tokens`) were
  dropped by 0003's upgrade and exist only in its downgrade path.
- **`CONCURRENTLY` discipline**: index builds on a live deploy go
  out-of-band with `CREATE INDEX CONCURRENTLY`, then the migration is
  stamped — 0007 already documents this pattern in-file; copy it, do
  not run a locking build inside `upgrade()` on prod data.
- **Still deferred, with owners**: `upgrade head` + `downgrade -1`
  against a disposable database in CI (blocked on §15 — no CI yet);
  `EXPLAIN` verification on prod-like data (no prod dataset exists);
  orphan-check scheduling (rides the §14 scheduler; until then the
  script's exit codes — 0 clean, 1 orphans, 2 failure — are CI-ready).
- Any new table must name its owner (Drizzle or Alembic) in its
  creating migration's docstring, or it defaults to Alembic app-side.
