"""P2 pooler routing + pool settings (T2.1, T2.2).

SQLite parity: no test here touches a real Postgres server. Postgres
kwargs are asserted on the dict returned by `engine_kwargs_for` and on
the arguments a stubbed `create_engine` receives; SQLite paths assert
no Postgres-only pool args leak into the engine.
"""

from __future__ import annotations

import logging

import pytest

from app import config
from app import db


@pytest.fixture()
def _reset_engine(monkeypatch):
    """Reset db.py's cached engine so each test builds a fresh one."""
    monkeypatch.setattr(db, "_engine", None)
    monkeypatch.setattr(db, "_SessionLocal", None)


# --- T2.1: pooled URL preferred, direct URL is fallback ---


def test_pooled_url_preferred_over_direct(monkeypatch):
    monkeypatch.setattr(config, "DATABASE_URL", "postgresql://u:p@ep-direct/x")
    monkeypatch.setattr(
        config, "DATABASE_URL_POOLED", "postgresql://u:p@ep-x-pooler/x"
    )
    assert config.effective_database_url() == "postgresql://u:p@ep-x-pooler/x"


def test_direct_url_fallback_when_no_pooled(monkeypatch):
    monkeypatch.setattr(config, "DATABASE_URL", "postgresql://u:p@ep-direct/x")
    monkeypatch.setattr(config, "DATABASE_URL_POOLED", None)
    assert config.effective_database_url() == "postgresql://u:p@ep-direct/x"


def test_no_url_when_neither_set(monkeypatch):
    monkeypatch.setattr(config, "DATABASE_URL", None)
    monkeypatch.setattr(config, "DATABASE_URL_POOLED", None)
    assert config.effective_database_url() is None


def test_validate_accepts_pooled_only(monkeypatch):
    monkeypatch.setattr(config, "DATABASE_URL", None)
    monkeypatch.setattr(
        config, "DATABASE_URL_POOLED", "postgresql://u:p@ep-x-pooler/x"
    )
    # Other required vars come from the test env (see conftest.py); only
    # the DB requirement is under test here — must not raise for it.
    try:
        config.validate_startup(require_db=True)
    except RuntimeError as exc:
        assert "DATABASE_URL" not in str(exc)


def test_validate_rejects_missing_both(monkeypatch):
    monkeypatch.setattr(config, "DATABASE_URL", None)
    monkeypatch.setattr(config, "DATABASE_URL_POOLED", None)
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        config.validate_startup(require_db=True)


# --- T2.2: explicit small pool, bounded timeouts ---


def test_postgres_kwargs_are_explicit_and_small():
    kwargs = db.engine_kwargs_for("postgresql+psycopg://u:p@ep-x-pooler/x")
    assert kwargs["pool_size"] <= 5
    assert kwargs["max_overflow"] <= 5
    # Burst checkout must fail fast, never queue behind the 30s default.
    assert kwargs["pool_timeout"] < 30
    assert kwargs["pool_recycle"] > 0
    assert kwargs["pool_pre_ping"] is True
    connect_args = kwargs["connect_args"]
    # Lowered from the previous 10s cold-connect bound.
    assert connect_args["connect_timeout"] < 10
    assert "statement_timeout" in connect_args["options"]


def test_sqlite_kwargs_carry_no_pool_args():
    kwargs = db.engine_kwargs_for("sqlite://")
    assert "pool_size" not in kwargs
    assert "max_overflow" not in kwargs
    assert "pool_timeout" not in kwargs
    assert "connect_args" not in kwargs or "connect_timeout" not in kwargs.get(
        "connect_args", {}
    )


def test_safe_host_hides_credentials():
    host = db.safe_db_host("postgresql://owner:s3cret@ep-x-pooler/x")
    assert "ep-x-pooler" in host
    assert "s3cret" not in host
    assert "owner" not in host


def test_get_engine_uses_effective_url_and_logs_host_only(
    monkeypatch, caplog, _reset_engine
):
    monkeypatch.setattr(config, "DATABASE_URL", "postgresql://u:p@ep-direct/x")
    monkeypatch.setattr(
        config,
        "DATABASE_URL_POOLED",
        "postgresql://owner:s3cret@ep-x-pooler/neondb?sslmode=require",
    )
    seen: dict = {}

    def _fake_create_engine(url, **kwargs):
        seen["url"] = url
        seen["kwargs"] = kwargs
        from sqlalchemy import create_engine as _real_create_engine

        return _real_create_engine("sqlite://")

    monkeypatch.setattr(db, "create_engine", _fake_create_engine)
    with caplog.at_level(logging.INFO, logger="app.db"):
        db.get_engine()
    assert seen["url"].startswith("postgresql://")
    assert "pooler" in seen["url"]
    assert seen["kwargs"]["pool_size"] <= 5
    log_text = caplog.text
    assert "pooler" in log_text
    assert "s3cret" not in log_text
    assert "owner" not in log_text


def test_get_engine_raises_when_no_url(monkeypatch, _reset_engine):
    monkeypatch.setattr(config, "DATABASE_URL", None)
    monkeypatch.setattr(config, "DATABASE_URL_POOLED", None)
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        db.get_engine()
