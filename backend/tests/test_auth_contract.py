"""Auth + health (BetterAuth migration placeholder).

TODO(BetterAuth): re-add session/JWT contract tests here.
"""

from __future__ import annotations


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
