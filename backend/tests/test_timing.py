"""Per-request timing (app/timing.py): headers, log line, counting rules.

Self-contained: each test builds its own SQLite engine + app (the shared
conftest engine has no timing listeners installed, which is exactly what
`test_without_engine_install` relies on).
"""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import timing
from app.db import get_db
from app.main import create_app


def _make_client(*, install: bool, double_install: bool = False) -> TestClient:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    if install:
        timing.install_engine_timing(engine)
        if double_install:
            timing.install_engine_timing(engine)
    TestingSession = sessionmaker(
        bind=engine, autoflush=False, expire_on_commit=False
    )

    def _override_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app = create_app(validate=False)
    app.dependency_overrides[get_db] = _override_db
    return TestClient(app)


@pytest.fixture()
def client():
    with _make_client(install=True) as c:
        yield c


def test_timing_headers_on_db_backed_route(client):
    """/ready runs exactly one statement (SELECT 1): headers must say so."""
    res = client.get("/api/v1/ready")
    assert res.status_code == 200
    total_ms = float(res.headers["X-Response-Time-Ms"])
    db_ms = float(res.headers["X-Db-Time-Ms"])
    queries = int(res.headers["X-Db-Queries"])
    assert total_ms >= 0.0
    assert db_ms >= 0.0
    assert queries == 1
    assert db_ms <= total_ms


def test_without_engine_install_still_serves_with_zeros():
    """Measurement is fail-open: no listeners, no crash, zeroed split."""
    with _make_client(install=False) as c:
        res = c.get("/api/v1/ready")
    assert res.status_code == 200
    assert float(res.headers["X-Db-Time-Ms"]) == 0.0
    assert int(res.headers["X-Db-Queries"]) == 0
    assert float(res.headers["X-Response-Time-Ms"]) >= 0.0


def test_double_install_counts_statements_once():
    """Re-installing on the same engine must not double-count."""
    with _make_client(install=True, double_install=True) as c:
        res = c.get("/api/v1/ready")
    assert res.status_code == 200
    assert int(res.headers["X-Db-Queries"]) == 1


def test_timing_log_line_shape(client, caplog):
    """One INFO line per request carrying the full split."""
    with caplog.at_level(logging.INFO, logger="pesdac.timing"):
        client.get("/api/v1/ready")
    lines = [
        r.getMessage() for r in caplog.records if r.name == "pesdac.timing"
    ]
    assert lines, "expected a pesdac.timing log line"
    line = lines[-1]
    assert "GET" in line
    assert " /ready " in line
    assert " 200 " in line
    assert "total_ms=" in line
    assert "db_ms=" in line
    assert "db_queries=1" in line


def test_timing_covers_unmatched_routes(client):
    """404s still get headers (the middleware sits above route matching)."""
    res = client.get("/api/v1/does-not-exist")
    assert res.status_code == 404
    assert float(res.headers["X-Response-Time-Ms"]) >= 0.0
    assert int(res.headers["X-Db-Queries"]) == 0


def test_timing_logger_visible_without_root_config():
    """Regression: plain uvicorn leaves root at WARNING with no handlers,
    which swallowed these INFO lines entirely (no timing output in dev).
    The logger must therefore emit on its own."""
    log = logging.getLogger("pesdac.timing")
    assert log.getEffectiveLevel() <= logging.INFO
    assert log.handlers, "needs its own console handler"


def _last_timing_line(caplog) -> str:
    lines = [r.getMessage() for r in caplog.records if r.name == "pesdac.timing"]
    assert lines, "expected a pesdac.timing log line"
    return lines[-1]


def test_log_line_logs_route_template_not_concrete_ids(client, caplog):
    """§17: low-cardinality labels — path params stay out of logs."""
    with caplog.at_level(logging.INFO, logger="pesdac.timing"):
        # No auth override here → 401, but routing runs first so the
        # template is what gets logged.
        assert client.get("/api/v1/chats/abc123/messages").status_code == 401
    line = _last_timing_line(caplog)
    # route.path is router-relative (no /api/v1 mount prefix — see
    # _log_label); the template, not the concrete code, is what matters.
    assert "/chats/{code}/messages" in line
    assert "abc123" not in line


def test_log_line_logs_param_names_never_values(client, caplog):
    """§17: query VALUES are user content (?q= search text) — the line
    keeps param NAMES only."""
    with caplog.at_level(logging.INFO, logger="pesdac.timing"):
        client.get("/api/v1/chats", params={"q": "tcp-secret-text", "limit": 2})
    line = _last_timing_line(caplog)
    assert "tcp-secret-text" not in line
    assert "?limit+q" in line
