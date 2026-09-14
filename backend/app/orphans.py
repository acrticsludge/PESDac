"""Orphan detection across the dual-ORM boundary (audit §7 item 3).

The two halves of the identity model live in different ORMs on one
shared Neon database and join by value only:

- BetterAuth identity: `"user".id` (Drizzle-owned, `lib/db/schema.ts`).
- App row: `users.auth_user_id` (SQLAlchemy-owned, `models/users.py`).

Two orphan directions, different meanings:

- Identity without app row: expected transiently (the delete-account
  contract deletes backend first, identity second; a re-login
  re-provisions via the `/auth/me` upsert), so these are INFO.
- App row without identity: no valid JWT can ever map to it again —
  true orphans. These are ACTION (manual review + delete; auto-delete
  needs a product decision, so this module only reports).

Read-only by construction: the identity table is declared id-only in
a separate MetaData and this module never issues DDL. Scheduling rides
the §14 scheduler when it exists; until then run on demand or from CI
(§15) — exit 1 on true orphans, 2 on config/connection failure.
"""

from __future__ import annotations

import os
import sys

from sqlalchemy import Column, MetaData, Table, Text, create_engine, select
from sqlalchemy.orm import Session

from app.models.users import User

orphan_metadata = MetaData()
# Mirrors the BetterAuth `user` table name + PK only (`lib/db/schema.ts`).
# Id-only is deliberate: the join needs no more, and a minimal
# declaration cannot drift into writing identity columns.
identity_user = Table("user", orphan_metadata, Column("id", Text, primary_key=True))


def identity_ids_without_app_row(session: Session) -> list[str]:
    """BetterAuth ids with no app row (transient/INFO — re-login heals)."""
    q = (
        select(identity_user.c.id)
        .outerjoin(User, User.auth_user_id == identity_user.c.id)
        .where(User.id.is_(None))
        .order_by(identity_user.c.id)
    )
    return list(session.scalars(q))


def app_auth_ids_without_identity(session: Session) -> list[str]:
    """App `auth_user_id`s with no BetterAuth row (true orphans/ACTION)."""
    q = (
        select(User.auth_user_id)
        .outerjoin(identity_user, identity_user.c.id == User.auth_user_id)
        .where(identity_user.c.id.is_(None))
        .order_by(User.auth_user_id)
    )
    return list(session.scalars(q))


def main() -> int:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("check_orphans: DATABASE_URL is not set", file=sys.stderr)
        return 2
    try:
        engine = create_engine(url)
        with Session(engine) as session:
            transient = identity_ids_without_app_row(session)
            orphans = app_auth_ids_without_identity(session)
    except Exception as exc:  # connection/auth failure — not an orphan verdict
        print(f"check_orphans: query failed: {exc}", file=sys.stderr)
        return 2
    print(f"identity-without-app-row (INFO, re-login heals): {len(transient)}")
    for sub in transient[:50]:
        print(f"  INFO {sub}")
    print(f"app-row-without-identity (ACTION, review + manual delete): {len(orphans)}")
    for sub in orphans[:50]:
        print(f"  ACTION {sub}")
    return 1 if orphans else 0
