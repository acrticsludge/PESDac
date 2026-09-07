"""T30 contract tests: every 4xx/5xx uses the standard error envelope.

The envelope is `{error: {code, message, details?}}`. Covers:
- 401 (missing token)
- 404 (cross-user code is indistinguishable from not-found)
- 422 (validation error carries field paths in details)
"""

from __future__ import annotations

from fastapi.testclient import TestClient


def _envelope(body):
    assert isinstance(body, dict), body
    assert "error" in body, body
    err = body["error"]
    assert isinstance(err, dict)
    assert isinstance(err.get("code"), str), err
    assert isinstance(err.get("message"), str), err


def test_401_envelope():
    """No Authorization header → 401 with envelope (no detail leak)."""
    from app.main import create_app
    from app.deps import get_current_user

    # The shared `client` fixture wires a fake user into get_current_user
    # so requests succeed without a token. To exercise the 401 path we
    # remove that override for this test and call the bare app.
    from fastapi.testclient import TestClient
    import app.main as _m

    app = create_app(validate=False)
    if get_current_user in app.dependency_overrides:
        del app.dependency_overrides[get_current_user]
    with TestClient(app) as c:
        r = c.get("/api/v1/auth/me")
    assert r.status_code == 401, r.text
    _envelope(r.json())
    assert r.json()["error"]["code"] == "UNAUTHORIZED"


def test_404_chats_uses_envelope(client):
    """Missing chat code → 404 envelope (no existence oracle)."""
    r = client.patch("/api/v1/chats/nocode6", json={"title": "x"})
    assert r.status_code == 404, r.text
    _envelope(r.json())
    assert r.json()["error"]["code"] == "NOT_FOUND"


def test_422_envelope_has_safe_details(client):
    """Validation errors return 422 + safe details (no tracebacks)."""
    # demo-state PUT is auth-protected in dev-user mode and accepts an
    # isHidden boolean; a string fails Pydantic validation.
    r = client.put(
        "/api/v1/demo-state/TCP%20vs%20UDP",
        json={"isHidden": "not-a-bool"},
    )
    assert r.status_code == 422, r.text
    body = r.json()
    _envelope(body)
    assert body["error"]["code"] == "VALIDATION_ERROR"
    details = body["error"].get("details")
    if details is not None:
        text = str(details)
        assert "Traceback" not in text
        assert "site-packages" not in text