"""Sync SQLAlchemy engine/session. Portable models (SQLite for tests, Neon for prod).

PG-idiomatic DDL (citext attempt, text[], vector ext) lives in the Alembic
migration, not here — models use String/JSON so contract tests run on SQLite
with zero API drift.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from urllib.parse import urlparse

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

from app import config

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


# Pool-size decision (T2.2; recorded here — this session owns only db.py,
# pool-related config env, and one test file, so the rationale lives in
# code comments rather than a separate ADR):
# A transaction pooler (Neon `-pooler` host) already sits in front of
# Postgres, so the app-side QueuePool stays deliberately SMALL — a large
# app pool would double-pool and pin idle server connections behind two
# layers of queueing.
# - pool_size=5 / max_overflow=5: enough for Starlette's threadpool
#   bursts without hoarding pooler slots.
# - pool_timeout=10 (was the 30s default): burst checkout waits fail fast
#   instead of queueing for half a minute inside the request.
# - pool_recycle=300: drop connections before Neon idles them out, so a
#   cold request never inherits a half-open socket.
# - connect_timeout=8: cold TLS + auth measured ~5s worst case at startup
#   warmup (direct URL; pooler similar), so 8s keeps a margin while still
#   failing fast on a suspended/unreachable Neon. pool_timeout=10 still
#   bounds the total checkout wait. This is a client-side libpq
#   parameter, so the pooler accepts it.
# - statement_timeout=15s is enforced with a `connect` listener
#   (`SET statement_timeout`), NOT via `connect_args["options"]`: the Neon
#   transaction pooler rejects `options` as a startup parameter
#   (probe-proven: "unsupported startup parameter in options ... use
#   unpooled connection or remove this parameter"), which breaks every
#   pooled checkout. Best-effort under transaction pooling (the pooler
#   may reset session state between transactions); the primary
#   tail-latency guards remain the small pool + bounded timeouts.
_POOL_SIZE = 5
_MAX_OVERFLOW = 5
_POOL_TIMEOUT = 10
_POOL_RECYCLE = 300
_CONNECT_TIMEOUT = 8
_STATEMENT_TIMEOUT = "15s"


def effective_url() -> str | None:
    """App-traffic connection string: pooled first, direct fallback."""
    return config.effective_database_url()


def safe_db_host(url: str) -> str:
    """Hostname for logs. Never includes userinfo, path, or query."""
    try:
        return urlparse(url).hostname or "(unknown-host)"
    except ValueError:
        return "(unknown-host)"


def engine_kwargs_for(url: str) -> dict:
    """Engine kwargs for a URL. Postgres-only pool args never leak into
    SQLite test engines (psqlite takes `timeout`, not pool args)."""
    kwargs: dict = {"pool_pre_ping": True}
    if url.startswith("postgres"):
        kwargs.update(
            {
                "pool_size": _POOL_SIZE,
                "max_overflow": _MAX_OVERFLOW,
                "pool_timeout": _POOL_TIMEOUT,
                "pool_recycle": _POOL_RECYCLE,
                # No `options` key: the pooler rejects startup parameters.
                "connect_args": {"connect_timeout": _CONNECT_TIMEOUT},
            }
        )
    return kwargs


def _set_statement_timeout(dbapi_conn, _connection_record) -> None:
    """Per-connection statement cap, applied as SQL (pooler-safe).

    Runs on every new DBAPI connection; kept separate from
    `engine_kwargs_for` so SQLite test engines never see it.
    """
    cursor = dbapi_conn.cursor()
    try:
        cursor.execute(f"SET statement_timeout = '{_STATEMENT_TIMEOUT}'")
    finally:
        cursor.close()


_engine = None
_SessionLocal: sessionmaker | None = None


def get_engine():
    global _engine, _SessionLocal
    if _engine is None:
        url = effective_url()
        if not url:
            raise RuntimeError("DATABASE_URL is not set")
        _engine = create_engine(url, **engine_kwargs_for(url))
        if url.startswith("postgres"):
            event.listen(_engine, "connect", _set_statement_timeout)
        # Host only — the URL carries credentials, never log it whole.
        logger.info("db engine: using host=%s pooled=%s", safe_db_host(url), bool(config.DATABASE_URL_POOLED))
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
