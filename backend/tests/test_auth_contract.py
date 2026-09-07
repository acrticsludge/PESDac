"""Auth + health (BetterAuth migration placeholder).

TODO(BetterAuth): re-add session/JWT contract tests here.
"""

from __future__ import annotations

from typing import Any

import pytest
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


def test_link_password_route_is_registered(client):
    """Keep the frontend/backend contract from regressing to a 404.

    The route is intentionally checked on the assembled FastAPI application,
    not only through a dependency-overridden request test. This catches a
    router-prefix or include_router regression before it reaches the browser.
    """
    # FastAPI 0.1x can retain included routers as deferred route objects in
    # `app.routes`; the generated OpenAPI is the stable assembled-app view.
    paths = client.app.openapi()["paths"]
    assert "post" in paths["/api/v1/auth/link-password"]


# --- link-password ----------------------------------------------------------
#
# This proxy route forwards to BetterAuth's serverOnly setPassword
# (POST /api/auth/set-password). The SQLite test stack has no live
# BetterAuth upstream, so each test patches httpx.AsyncClient.post
# with a stub and asserts on the call shape + our envelope on failure.

class _StubResponse:
    def __init__(self, status_code: int, body: dict[str, Any] | None = None):
        self.status_code = status_code
        self._body = body or {}
        self.is_success = 200 <= status_code < 300

    def json(self) -> dict[str, Any]:
        return self._body


def _patch_upstream(monkeypatch, response: _StubResponse, capture: dict[str, Any] | None = None):
    """Replace httpx.AsyncClient.post with a stub that records the call
    and returns the canned response. Both the closure and the patched
    AsyncClient instance are returned so the test can assert on either."""

    class _StubClient:
        def __init__(self, *args, **kwargs):
            self._response = response
            self._capture = capture if capture is not None else {}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json=None, headers=None):
            self._capture["url"] = url
            self._capture["json"] = json
            self._capture["headers"] = headers or {}
            return self._response

    monkeypatch.setattr("app.routers.auth.httpx.AsyncClient", _StubClient)


def test_link_password_happy_path(client: TestClient, monkeypatch):
    capture: dict[str, Any] = {}
    _patch_upstream(monkeypatch, _StubResponse(200, {"status": True}), capture)

    r = client.post(
        "/api/v1/auth/link-password",
        json={"newPassword": "passwordpassword"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}
    # The cookie header is forwarded through.
    assert capture["json"] == {"newPassword": "passwordpassword"}


def test_link_password_validates_length(client: TestClient, monkeypatch):
    # 422 must come from Pydantic BEFORE we hit the upstream, so the
    # upstream stub is unused; install a failing one to prove the call
    # never lands.
    called = {"count": 0}

    class _Boom:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return None
        async def post(self, *a, **kw):
            called["count"] += 1
            raise AssertionError("must not reach upstream on 422")

    monkeypatch.setattr("app.routers.auth.httpx.AsyncClient", _Boom)

    r = client.post(
        "/api/v1/auth/link-password",
        json={"newPassword": "short"},  # 5 chars, < 8
    )
    assert r.status_code == 422
    assert called["count"] == 0


def test_link_password_missing_body_field(client: TestClient, monkeypatch):
    r = client.post("/api/v1/auth/link-password", json={})
    assert r.status_code == 422


def test_link_password_origin_rejected(client: TestClient, monkeypatch):
    # 403 takes priority over 200; the upstream stub is never called.
    _patch_upstream(monkeypatch, _StubResponse(200, {"status": True}))
    r = client.post(
        "/api/v1/auth/link-password",
        json={"newPassword": "passwordpassword"},
        headers={"Origin": "https://evil.example"},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"


def test_link_password_rate_limited(client: TestClient, monkeypatch):
    _patch_upstream(monkeypatch, _StubResponse(200, {"status": True}))
    # 5 hits in the window pass; the 6th gets 429.
    for _ in range(5):
        r = client.post(
            "/api/v1/auth/link-password",
            json={"newPassword": "passwordpassword"},
        )
        assert r.status_code == 200, r.text
    r = client.post(
        "/api/v1/auth/link-password",
        json={"newPassword": "passwordpassword"},
    )
    assert r.status_code == 429
    assert r.headers.get("Retry-After") is not None
    assert r.json()["error"]["code"] == "RATE_LIMITED"


def test_link_password_upstream_validation_422(client: TestClient, monkeypatch):
    # BetterAuth server rejected the password (e.g. character class).
    # We surface the upstream message under AUTH_VALIDATION.
    _patch_upstream(
        monkeypatch,
        _StubResponse(422, {"message": "Password too weak."}),
    )
    r = client.post(
        "/api/v1/auth/link-password",
        json={"newPassword": "passwordpassword"},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "AUTH_VALIDATION"
    assert r.json()["error"]["message"] == "Password too weak."


def test_link_password_upstream_unreachable(client: TestClient, monkeypatch):
    class _Fail:
        def __init__(self, *a, **kw):
            pass
        async def __aenter__(self):
            return self
        async def __aexit__(self, *a):
            return None
        async def post(self, *a, **kw):
            import httpx as _h
            raise _h.ConnectError("boom", request=_h.Request("POST", "x"))

    monkeypatch.setattr("app.routers.auth.httpx.AsyncClient", _Fail)
    r = client.post(
        "/api/v1/auth/link-password",
        json={"newPassword": "passwordpassword"},
    )
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "AUTH_UNREACHABLE"
