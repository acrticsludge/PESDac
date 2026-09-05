"""Auth contract: signup/login/logout/refresh/me/reset (arch §7.1, §13)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app import security
from app.models.users import PasswordResetToken, RefreshToken, User
from tests.conftest import signup


def test_health_and_ready(client):
    assert client.get("/api/v1/health").json() == {"ok": True}
    assert client.get("/api/v1/ready").json() == {"ok": True}


def test_signup_sets_cookies_and_me(client):
    signup(client)
    assert "pesdac_at" in client.cookies
    assert "pesdac_rt" in client.cookies
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 200
    assert r.json()["user"]["email"] == "you@example.com"


def test_signup_duplicate_is_409_envelope(client):
    signup(client)
    r = client.post("/api/v1/auth/signup", json={"email": "you@example.com", "password": "correct-horse-12345"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "EMAIL_TAKEN"


def test_signup_short_password_is_422_envelope(client):
    r = client.post("/api/v1/auth/signup", json={"email": "a@b.co", "password": "short"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


def test_login_ok_and_bad_credentials_share_message(client):
    signup(client)
    client.cookies.clear()
    r = client.post("/api/v1/auth/login", json={"email": "you@example.com", "password": "correct-horse-12345"})
    assert r.status_code == 200
    r = client.post("/api/v1/auth/login", json={"email": "you@example.com", "password": "wrong-password-00000"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "INVALID_CREDENTIALS"
    r = client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "wrong-password-00000"})
    assert r.status_code == 401
    assert r.json()["error"] == client.post(
        "/api/v1/auth/login", json={"email": "you@example.com", "password": "wrong-password-00000"}
    ).json()["error"]


def test_refresh_rotates_and_reuse_kills_family(client):
    signup(client)
    old_refresh = client.cookies["pesdac_rt"]
    r = client.post("/api/v1/auth/refresh")
    assert r.status_code == 200
    new_refresh = client.cookies["pesdac_rt"]
    assert new_refresh != old_refresh
    # Attacker replays the old token → 401 and the whole family is revoked.
    client.cookies.set("pesdac_rt", old_refresh)
    assert client.post("/api/v1/auth/refresh").status_code == 401
    client.cookies.set("pesdac_rt", new_refresh)
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_logout_clears_and_revokes(client):
    signup(client)
    assert client.post("/api/v1/auth/logout").status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.post("/api/v1/auth/refresh").status_code == 401


def test_me_unauthenticated_is_envelope(client):
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHORIZED"


def test_password_request_always_202_no_oracle(client):
    signup(client)
    for email in ("you@example.com", "ghost@example.com"):
        r = client.post("/api/v1/auth/password/request", json={"email": email})
        assert r.status_code == 202, r.text


def test_password_confirm_roundtrip_and_single_use(client, dbsession):
    import uuid as _uuid

    user = signup(client)
    token = "test-reset-token-abc123"
    row = PasswordResetToken(
        user_id=_uuid.UUID(user["id"]), token_hash=security.hash_token(token),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=60),
    )
    dbsession.add(row)
    dbsession.commit()
    r = client.post("/api/v1/auth/password/confirm", json={"token": token, "newPassword": "brand-new-password-9"})
    assert r.status_code == 200, r.text
    assert client.post("/api/v1/auth/password/confirm", json={"token": token, "newPassword": "brand-new-password-9"}).status_code == 400
    # Old sessions revoked; new password works.
    client.cookies.clear()
    r = client.post("/api/v1/auth/login", json={"email": "you@example.com", "password": "brand-new-password-9"})
    assert r.status_code == 200


def test_password_confirm_garbage_is_400(client):
    r = client.post("/api/v1/auth/password/confirm", json={"token": "nope", "newPassword": "brand-new-password-9"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "INVALID_TOKEN"


def test_google_start_unconfigured_is_501(client):
    r = client.get("/api/v1/auth/google/start")
    assert r.status_code == 501
    assert r.json()["error"]["code"] == "OAUTH_NOT_CONFIGURED"
