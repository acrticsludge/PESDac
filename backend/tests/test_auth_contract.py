"""Auth + health (BetterAuth migration placeholder).

TODO(BetterAuth): re-add session/JWT contract tests here.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_and_ready(client):
    assert client.get("/api/v1/health").json() == {"ok": True}
    assert client.get("/api/v1/ready").json() == {"ok": True}


def test_me_returns_dev_user(client):
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == "test@example.com"


def test_logout_is_204_for_anonymous(client):
    r = client.post("/api/v1/auth/logout")
    assert r.status_code == 204


def test_me_401_uses_envelope():
    """Slice 13: every 401 in the app uses the {error: {code, message}}
    envelope. Built via create_app(validate=False) so the global
    HTTPException handler in main.py is installed (it translates
    FastAPI's default {detail: ...} shape into the envelope)."""
    import os
    os.environ.setdefault("DATABASE_URL", "sqlite://")
    os.environ.setdefault("FRONTEND_ORIGINS", "http://testserver")
    os.environ.setdefault("COOKIE_SECURE", "false")
    os.environ.setdefault("BETTER_AUTH_URL", "http://localhost:4321")
    os.environ.setdefault("BETTER_AUTH_SECRET", "test-secret-32-characters-long!!")

    from app.main import create_app

    app = create_app(validate=False)
    with TestClient(app, raise_server_exceptions=False) as c:
        r = c.get("/api/v1/auth/me")
    assert r.status_code == 401, r.text
    body = r.json()
    assert "error" in body, body
    assert body["error"]["code"] == "UNAUTHORIZED"
    assert "message" in body["error"]
