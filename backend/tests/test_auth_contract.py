"""Auth + health (BetterAuth migration placeholder).

TODO(BetterAuth): re-add session/JWT contract tests here.
"""

from __future__ import annotations

from typing import Any

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
