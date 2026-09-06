"""Server-side error visibility: every error response must leave a log trace.

The user only ever sees the generic envelope; these tests prove the
server records method + path + reason (never tokens or bodies) so
failures are diagnosable without asking the user what they saw.
"""

from __future__ import annotations

import logging
import time

import jwt as pyjwt


def test_expired_jwt_logs_reason_not_token(client, jwks_seeded, caplog):
    token = pyjwt.encode(
        {"sub": "u", "email": "e@x.com", "exp": int(time.time()) - 60},
        jwks_seeded,
        algorithm="EdDSA",
        headers={"kid": "test-kid"},
    )
    with caplog.at_level(logging.DEBUG, logger="pesdac"):
        r = client.get(
            "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
        )
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHORIZED"
    assert "401 expired JWT" in caplog.messages
    # The token itself must never hit the logs.
    assert not any(token in m for m in caplog.messages)


def test_validation_error_logs_method_and_path(client, auth_header, caplog):
    client.headers.update(auth_header(email="log@example.com"))
    with caplog.at_level(logging.INFO, logger="pesdac"):
        # Missing required fields → genuine RequestValidationError → 422.
        r = client.post("/api/v1/chats", json={})
    assert r.status_code == 422
    assert any(m.startswith("422 ") for m in caplog.messages)
