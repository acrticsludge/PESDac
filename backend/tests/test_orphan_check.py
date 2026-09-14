"""Orphan-check queries (audit §7 item 3).

Behavioral on SQLite: the BetterAuth `user` table is recreated here as
the same id-only declaration the script uses in prod, so both join
directions run for real. Also pins the read-only contract (the orphan
metadata holds exactly one table — the module can report, never
migrate) and the exit codes.
"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db import Base
from app.models.users import User
from app.orphans import (
    app_auth_ids_without_identity,
    identity_ids_without_app_row,
    identity_user,
    main,
    orphan_metadata,
)

_engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
_TestingSession = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)


def _session() -> Session:
    Base.metadata.drop_all(bind=_engine)
    orphan_metadata.drop_all(bind=_engine)
    Base.metadata.create_all(bind=_engine)
    orphan_metadata.create_all(bind=_engine)
    return _TestingSession()


def test_both_orphan_directions():
    db = _session()
    db.add(User(auth_user_id="linked-sub", email="a@example.com", display_name="A"))
    db.add(User(auth_user_id="orphan-sub", email="b@example.com", display_name="B"))
    db.execute(identity_user.insert().values([{"id": "linked-sub"}, {"id": "ghost-sub"}]))
    db.commit()

    assert identity_ids_without_app_row(db) == ["ghost-sub"]
    assert app_auth_ids_without_identity(db) == ["orphan-sub"]

    # Healing the app side clears the ACTION list; the INFO side is
    # unaffected (ghost identity still has no app row).
    db.execute(identity_user.insert().values({"id": "orphan-sub"}))
    db.commit()
    assert app_auth_ids_without_identity(db) == []
    assert identity_ids_without_app_row(db) == ["ghost-sub"]
    db.close()


def test_clean_database_reports_empty():
    db = _session()
    db.add(User(auth_user_id="only-sub", email="c@example.com", display_name="C"))
    db.execute(identity_user.insert().values({"id": "only-sub"}))
    db.commit()
    assert identity_ids_without_app_row(db) == []
    assert app_auth_ids_without_identity(db) == []
    db.close()


def test_orphan_metadata_is_report_only():
    assert set(orphan_metadata.tables) == {"user"}
    assert list(identity_user.columns.keys()) == ["id"]


def test_main_without_database_url_exits_config_error(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert main() == 2
