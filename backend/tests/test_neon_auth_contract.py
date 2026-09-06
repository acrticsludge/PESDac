"""v6 auth contract: Neon JWT verify + /me upsert + /logout 204 (TDD).

Spec login-signup v6 §7.1, §10. JWKS is monkeypatched via
`app.auth.neon._set_loader` so tests don't hit the network.
"""

from __future__ import annotations

import io
import json
import time
import urllib.request
import uuid
from base64 import urlsafe_b64encode

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import config
from app.auth import neon
from app.db import Base
from app.models.profiles import Profile
from app.models.users import User


# ---------- helpers: generate a real Ed25519 keypair + sign a JWT ----------

@pytest.fixture(scope="module")
def ed_keypair():
    priv = Ed25519PrivateKey.generate()
    pub = priv.public_key().public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return priv, pub


def _b64u(b: bytes) -> str:
    return urlsafe_b64encode(b).rstrip(b"=").decode()


def _jwk_for(pub_der: bytes) -> dict:
    """Minimal JWK for an Ed25519 public key. Uses kid='test-kid'."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    pub = serialization.load_der_public_key(pub_der)
    assert isinstance(pub, Ed25519PublicKey)
    raw = pub.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return {
        "kty": "OKP",
        "crv": "Ed25519",
        "kid": "test-kid",
        "alg": "EdDSA",
        "x": _b64u(raw),
    }


def _make_jwt(priv, kid: str = "test-kid", **claims) -> str:
    payload = {
        "sub": claims.get("sub", "neon-sub-" + uuid.uuid4().hex[:8]),
        "email": claims.get("email", "user@example.com"),
        "name": claims.get("name", "User"),
        "iat": int(time.time()),
        "exp": int(time.time()) + 3600,
    }
    return pyjwt.encode(payload, priv, algorithm="EdDSA", headers={"kid": kid})


@pytest.fixture()
def jwks_seeded(ed_keypair, monkeypatch):
    """Prime the JWKS cache + monkeypatch the loader to return the same key."""
    priv, pub_der = ed_keypair
    jwk = _jwk_for(pub_der)
    monkeypatch.setattr(config, "NEON_AUTH_JWKS_URL", "https://test.invalid/jwks", raising=False)
    neon.reset_cache()
    neon._add_to_cache({"test-kid": jwk})
    neon._set_loader(lambda url: {"test-kid": jwk})  # in case the test triggers a refetch
    yield priv
    neon.reset_cache()


# ---------- /me ----------

def test_me_unauthenticated_is_401_envelope(client: TestClient):
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "UNAUTHORIZED"


def test_me_creates_user_and_returns_payload_on_first_call(client: TestClient, jwks_seeded, dbsession):
    priv = jwks_seeded
    token = _make_jwt(priv, sub="neon-sub-abc", email="new@example.com", name="New User")
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["email"] == "new@example.com"
    assert body["user"]["displayName"] == "New User"
    assert body["user"]["onboardingDone"] is False
    user = dbsession.scalar(select(User).where(User.neon_user_id == "neon-sub-abc"))
    assert user is not None
    # A blank profile row is created on first /me (per spec §7.1).
    assert dbsession.get(Profile, user.id) is not None


def test_me_returns_same_user_on_repeated_calls(client: TestClient, jwks_seeded, dbsession):
    priv = jwks_seeded
    token = _make_jwt(priv, sub="neon-sub-xyz", email="x@example.com", name="X")
    first = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    second = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert first["user"]["id"] == second["user"]["id"]
    users = dbsession.scalars(select(User).where(User.neon_user_id == "neon-sub-xyz")).all()
    assert len(users) == 1


def test_me_upsert_adopts_race_winner(dbsession, monkeypatch):
    """Parallel first-login calls (onboarding fires /auth/me +
    /profiles/me together) can both SELECT-miss then both INSERT. The
    loser must adopt the winner's row, not 500."""
    from app.deps import _insert_or_select

    sub = "neon-sub-race"
    raced = {"done": False}
    real_commit = dbsession.commit

    def racy_commit():
        if not raced["done"]:
            raced["done"] = True
            # A parallel request's row lands first: shelve our pending
            # INSERT, commit the winner, re-queue ours.
            pending = list(dbsession.new)
            for obj in pending:
                dbsession.expunge(obj)
            dbsession.add(
                User(neon_user_id=sub, email="w@example.com", display_name="Winner")
            )
            real_commit()
            for obj in pending:
                dbsession.add(obj)
        return real_commit()

    monkeypatch.setattr(dbsession, "commit", racy_commit)
    user = _insert_or_select(
        dbsession,
        lambda: dbsession.scalar(select(User).where(User.neon_user_id == sub)),
        lambda: User(neon_user_id=sub, email="l@example.com", display_name="Loser"),
    )
    assert user.email == "w@example.com"
    rows = dbsession.scalars(select(User).where(User.neon_user_id == sub)).all()
    assert len(rows) == 1


def test_me_rejects_token_with_unknown_kid(client: TestClient, jwks_seeded):
    priv = jwks_seeded
    token = _make_jwt(priv, kid="other-kid", email="x@example.com")
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_me_rejects_garbage_token(client: TestClient, jwks_seeded):
    r = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


# ---------- /logout ----------

def test_logout_returns_204_and_does_not_touch_state(client: TestClient, jwks_seeded):
    priv = jwks_seeded
    token = _make_jwt(priv, sub="neon-sub-log", email="l@example.com")
    client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    r = client.post("/api/v1/auth/logout")
    assert r.status_code == 204


# ---------- JWT verifier unit ----------

def test_verify_neon_jwt_returns_claims_for_known_kid(jwks_seeded):
    priv = jwks_seeded
    token = _make_jwt(priv, sub="u", email="e@x.com", name="N")
    claims = neon.verify_neon_jwt(token)
    assert claims["sub"] == "u"
    assert claims["email"] == "e@x.com"


def test_verify_neon_jwt_rejects_missing_kid(jwks_seeded):
    # Encode a token with no kid header.
    token = pyjwt.encode(
        {"sub": "u", "email": "e@x.com", "exp": int(time.time()) + 60},
        jwks_seeded, algorithm="EdDSA",
    )
    with pytest.raises(pyjwt.InvalidTokenError):
        neon.verify_neon_jwt(token)


def test_verify_neon_jwt_rejects_wrong_alg(jwks_seeded):
    # HS256 token signed with a different key. Must fail because we require EdDSA.
    token = pyjwt.encode(
        {"sub": "u", "email": "e@x.com", "exp": int(time.time()) + 60},
        "not-an-ed25519-key", algorithm="HS256", headers={"kid": "test-kid"},
    )
    with pytest.raises(pyjwt.InvalidTokenError):
        neon.verify_neon_jwt(token)


def test_verify_neon_jwt_rejects_expired_token(jwks_seeded):
    priv = jwks_seeded
    token = pyjwt.encode(
        {"sub": "u", "email": "e@x.com", "exp": int(time.time()) - 60},
        priv, algorithm="EdDSA", headers={"kid": "test-kid"},
    )
    with pytest.raises(pyjwt.ExpiredSignatureError):
        neon.verify_neon_jwt(token)


def test_verify_neon_jwt_rejects_tampered_signature(jwks_seeded):
    # Right kid, right claims — but signed by a different Ed25519 key.
    other_priv = Ed25519PrivateKey.generate()
    token = _make_jwt(other_priv, sub="u", email="e@x.com")
    with pytest.raises(pyjwt.InvalidSignatureError):
        neon.verify_neon_jwt(token)


def test_default_loader_fetches_jwks_over_http(ed_keypair, monkeypatch):
    # C1 regression: the production path (no test loader, cold cache)
    # must fetch the JWKS document itself — not just read the dict.
    priv, pub_der = ed_keypair
    doc = json.dumps({"keys": [_jwk_for(pub_der)]}).encode()
    monkeypatch.setattr(config, "NEON_AUTH_JWKS_URL", "https://test.invalid/jwks", raising=False)
    monkeypatch.setattr(
        urllib.request, "urlopen", lambda req, timeout=10: io.BytesIO(doc)
    )
    neon.reset_cache()
    try:
        claims = neon.verify_neon_jwt(_make_jwt(priv, sub="u", email="e@x.com"))
        assert claims["sub"] == "u"
    finally:
        neon.reset_cache()
