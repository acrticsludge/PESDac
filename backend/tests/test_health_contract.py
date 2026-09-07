"""Health endpoint contract (arch §10).

Slice 13: /ready returns the standard {error: {code, message}} envelope
on 503, matching every other 4xx/5xx in the app.
"""

from __future__ import annotations

import os

from fastapi.testclient import TestClient


def test_health_ok(client):
    assert client.get("/api/v1/health").json() == {"ok": True}


def test_ready_ok(client):
    assert client.get("/api/v1/ready").json() == {"ok": True}


def test_ready_503_uses_envelope():
    """When the DB SELECT fails, /ready returns 503 with the
    {error: {code, message}} envelope — not the bare {ok: false}
    it used to ship with (see docs/api-design-audit.md §2.2)."""
    os.environ.setdefault("DATABASE_URL", "sqlite://")
    os.environ.setdefault("FRONTEND_ORIGINS", "http://testserver")
    os.environ.setdefault("COOKIE_SECURE", "false")
    os.environ.setdefault("BETTER_AUTH_URL", "http://localhost:4321")
    os.environ.setdefault("BETTER_AUTH_SECRET", "test-secret-32-characters-long!!")

    from app.db import get_db
    from app.main import create_app

    app = create_app(validate=False)

    # Override get_db with a session whose execute() raises. The
    # route's `db.execute(text("SELECT 1"))` call is wrapped in a
    # try/except, so the failure becomes a 503 with the envelope.
    class _BrokenSession:
        def execute(self, *_args, **_kwargs):
            raise RuntimeError("simulated DB down")

    def _broken_db():
        return _BrokenSession()

    app.dependency_overrides[get_db] = _broken_db

    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/api/v1/ready")
    assert r.status_code == 503, r.text
    body = r.json()
    assert body["error"]["code"] == "UNHEALTHY"
    assert "Database" in body["error"]["message"]
