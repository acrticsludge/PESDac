"""Sync SQLAlchemy engine/session. Portable models (SQLite for tests, Neon for prod).

PG-idiomatic DDL (citext attempt, text[], vector ext) lives in the Alembic
migration, not here — models use String/JSON so contract tests run on SQLite
with zero API drift.
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

from app import config


class Base(DeclarativeBase):
    pass


_engine = None
_SessionLocal: sessionmaker | None = None


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        if not config.DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not set")
        # connect_timeout (Postgres only — pysqlite takes `timeout`, so
        # SQLite test engines must not receive it): a suspended /
        # unreachable Neon must fail fast (warning + serve) instead of
        # hanging startup forever — the lifespan warmup and first requests
        # share this bound. psycopg2 has no default timeout; 10s covers
        # cold TLS + auth with margin.
        kwargs: dict = {"pool_pre_ping": True}
        if config.DATABASE_URL.startswith("postgres"):
            kwargs["connect_args"] = {"connect_timeout": 10}
        _engine = create_engine(config.DATABASE_URL, **kwargs)
        _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)
    assert _SessionLocal is not None
    return _engine


def session_factory() -> sessionmaker:
    get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def get_db() -> Iterator[Session]:
    db = session_factory()()
    try:
        yield db
    finally:
        db.close()
