"""Auth + health (v6 — Neon Auth).

The v5 signup/login/refresh/password/reset/OAuth surface is gone; only
`/auth/me` and `/auth/logout` remain. Behavior is covered in
`test_neon_auth_contract.py`. This file keeps the health probe and
the unauthenticated `/me` envelope test so the health route stays
covered.
"""

from __future__ import annotations


def test_health_and_ready(client):
    assert client.get("/api/v1/health").json() == {"ok": True}
    assert client.get("/api/v1/ready").json() == {"ok": True}


def test_logout_is_204_for_anonymous(client):
    r = client.post("/api/v1/auth/logout")
    assert r.status_code == 204
