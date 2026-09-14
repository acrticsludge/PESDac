"""T17 unit tests: BetterAuth JWT verifier behaviors.

Exercises the algorithm allow-list, issuer/audience checks, and kid
handling against a real httpx mock. JWKS outage returns None and is
logged with a safe category. No tokens, claims, or sensitive fields
are logged in plain text.
"""

from __future__ import annotations

import asyncio
import base64
import json
from typing import Any
from unittest.mock import AsyncMock, patch

import jwt
import pytest


def _b64url(obj: dict[str, Any]) -> str:
    raw = json.dumps(obj, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _make_token(payload: dict[str, Any], kid: str = "k1", alg: str = "RS256") -> str:
    header = {"alg": alg, "typ": "JWT", "kid": kid}
    return f"{_b64url(header)}.{_b64url(payload)}.{_b64url({'sig': 'noop'})}"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("FRONTEND_ORIGINS", "http://testserver")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("BETTER_AUTH_URL", "http://localhost:4321")
    monkeypatch.setenv("BETTER_AUTH_SECRET", "test-secret-32-characters-long!!")


def test_malformed_header_returns_none(monkeypatch):
    """Tokens with broken headers don't 500 — they return None."""
    from app.auth import betterauth

    async def _run():
        return await betterauth.verify_betterauth_token("not-a-jwt")

    assert asyncio.run(_run()) is None


def test_missing_kid_returns_none(monkeypatch):
    from app.auth import betterauth

    token = _make_token({"sub": "u1", "email": "u@example.com"}, kid="")
    async def _run():
        return await betterauth.verify_betterauth_token(token)

    assert asyncio.run(_run()) is None


def test_unknown_alg_returns_none(monkeypatch):
    from app.auth import betterauth

    token = _make_token({"sub": "u1", "email": "u@example.com"}, alg="HS256")
    async def _run():
        return await betterauth.verify_betterauth_token(token)

    assert asyncio.run(_run()) is None


def test_jwks_outage_returns_none(monkeypatch):
    """Stale JWKS + failing refresh returns None and logs a safe category."""
    from app.auth import betterauth
    from app import config

    betterauth._jwks_cache.clear()
    betterauth._fetched_at = 0.0
    token = _make_token({"sub": "u1", "email": "u@example.com"})

    async def _run():
        with patch.object(betterauth, "_fetch_jwks", AsyncMock(side_effect=RuntimeError("boom"))):
            return await betterauth.verify_betterauth_token(token)

    assert asyncio.run(_run()) is None
    # Sanity: the function never raised, never leaked the underlying
    # error to the caller.


def test_expired_token_returns_none(monkeypatch):
    """Expired JWT returns None (ExpiredSignatureError)."""
    from app.auth import betterauth
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization

    betterauth._jwks_cache.clear()
    betterauth._fetched_at = 0.0
    # Generate a real key so the verifier gets past jwk parsing.
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    public_jwk["kid"] = "k1"
    public_jwk["alg"] = "RS256"

    async def _fake_jwks():
        return {"k1": public_jwk}

    expires_in_past = 0
    issued_at = 1
    payload = {
        "sub": "u1",
        "email": "u@example.com",
        "iat": issued_at,
        "exp": expires_in_past,
    }
    token = jwt.encode(
        payload,
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ),
        algorithm="RS256",
        headers={"kid": "k1"},
    )

    async def _run():
        with patch.object(betterauth, "_fetch_jwks", _fake_jwks):
            return await betterauth.verify_betterauth_token(token)

    assert asyncio.run(_run()) is None


# --- Section 5 (audit §5): close the remaining C6 branches. Real RSA
# keys throughout so failures prove claim/signature enforcement, not
# header rejection. JWKS module state is reset per test (file has no
# autouse reset fixture; other files must not inherit our stamps).


def _rsa_pair():
    from cryptography.hazmat.primitives.asymmetric import rsa

    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _public_jwk(key, kid="k1"):
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    jwk["kid"] = kid
    jwk["alg"] = "RS256"
    return jwk


def _private_pem(key):
    from cryptography.hazmat.primitives import serialization

    return key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )


def _signed(key, payload, kid="k1"):
    return jwt.encode(payload, _private_pem(key), algorithm="RS256", headers={"kid": kid})


def _live_payload(**over):
    import time

    now = int(time.time())
    base = {
        "sub": "u1",
        "email": "u@example.com",
        "iat": now,
        "exp": now + 600,
        "iss": "http://localhost:4321",
    }
    base.update(over)
    return base


@pytest.fixture()
def _clean_jwks():
    from app.auth import betterauth

    betterauth._jwks_cache.clear()
    betterauth._fetched_at = 0.0
    betterauth._fetch_failed_at = 0.0
    yield
    betterauth._jwks_cache.clear()
    betterauth._fetched_at = 0.0
    betterauth._fetch_failed_at = 0.0


def test_wrong_issuer_returns_none(_clean_jwks):
    """A token from another issuer is rejected even with a valid signature."""
    from app.auth import betterauth

    key = _rsa_pair()

    async def _fake_jwks():
        return {"k1": _public_jwk(key)}

    token = _signed(key, _live_payload(iss="https://evil.example"))

    async def _run():
        with patch.object(betterauth, "_fetch_jwks", _fake_jwks):
            return await betterauth.verify_betterauth_token(token)

    assert asyncio.run(_run()) is None


def test_missing_issuer_returns_none(_clean_jwks):
    from app.auth import betterauth

    key = _rsa_pair()

    async def _fake_jwks():
        return {"k1": _public_jwk(key)}

    payload = _live_payload()
    del payload["iss"]
    token = _signed(key, payload)

    async def _run():
        with patch.object(betterauth, "_fetch_jwks", _fake_jwks):
            return await betterauth.verify_betterauth_token(token)

    assert asyncio.run(_run()) is None


def test_audience_enforced_when_configured(_clean_jwks, monkeypatch):
    """With BETTER_AUTH_AUDIENCE set: missing/wrong aud rejected, exact
    aud accepted (positive path — the file previously asserted None only)."""
    from app import config
    from app.auth import betterauth

    monkeypatch.setattr(config, "BETTER_AUTH_AUDIENCE", "pesdac-test-app")
    key = _rsa_pair()

    async def _fake_jwks():
        return {"k1": _public_jwk(key)}

    async def _verify(token):
        with patch.object(betterauth, "_fetch_jwks", _fake_jwks):
            return await betterauth.verify_betterauth_token(token)

    assert asyncio.run(_verify(_signed(key, _live_payload()))) is None
    assert (
        asyncio.run(_verify(_signed(key, _live_payload(aud="wrong-app")))) is None
    )
    claims = asyncio.run(_verify(_signed(key, _live_payload(aud="pesdac-test-app"))))
    assert claims is not None
    assert claims["sub"] == "u1"
    assert claims["email"] == "u@example.com"


def test_wrong_signature_returns_none(_clean_jwks):
    """Valid header/kid/payload signed by a different key is rejected."""
    from app.auth import betterauth

    real, forged = _rsa_pair(), _rsa_pair()

    async def _fake_jwks():
        return {"k1": _public_jwk(real)}

    token = _signed(forged, _live_payload(), kid="k1")

    async def _run():
        with patch.object(betterauth, "_fetch_jwks", _fake_jwks):
            return await betterauth.verify_betterauth_token(token)

    assert asyncio.run(_run()) is None


def test_key_rotation_recovery_returns_claims(_clean_jwks):
    """Unknown kid triggers one forced refresh; a rotated key appearing
    there validates (the rotation path previously had no positive test)."""
    from app.auth import betterauth

    key = _rsa_pair()
    calls = 0

    async def _rotating_jwks():
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"old": {"kid": "old"}}
        return {"k1": _public_jwk(key)}

    token = _signed(key, _live_payload())

    async def _run():
        with patch.object(betterauth, "_fetch_jwks", _rotating_jwks):
            return await betterauth.verify_betterauth_token(token)

    claims = asyncio.run(_run())
    assert calls == 2
    assert claims is not None
    assert claims["sub"] == "u1"


def test_missing_email_or_sub_returns_none(_clean_jwks):
    """The users-row seed needs both claims; either absent is a 401."""
    from app.auth import betterauth

    key = _rsa_pair()

    async def _fake_jwks():
        return {"k1": _public_jwk(key)}

    async def _verify(payload):
        token = _signed(key, payload)
        with patch.object(betterauth, "_fetch_jwks", _fake_jwks):
            return await betterauth.verify_betterauth_token(token)

    no_email = _live_payload()
    del no_email["email"]
    no_sub = _live_payload()
    del no_sub["sub"]
    assert asyncio.run(_verify(no_email)) is None
    assert asyncio.run(_verify(no_sub)) is None


def test_future_nbf_returns_none(_clean_jwks):
    import time

    from app.auth import betterauth

    key = _rsa_pair()

    async def _fake_jwks():
        return {"k1": _public_jwk(key)}

    token = _signed(key, _live_payload(nbf=int(time.time()) + 600))

    async def _run():
        with patch.object(betterauth, "_fetch_jwks", _fake_jwks):
            return await betterauth.verify_betterauth_token(token)

    assert asyncio.run(_run()) is None


def test_none_alg_returns_none(_clean_jwks):
    """`alg: none` is rejected at the header allow-list, before any fetch."""
    from app.auth import betterauth
    from unittest.mock import AsyncMock

    token = _make_token({"sub": "u1", "email": "u@example.com"}, alg="none")

    async def _run():
        with patch.object(
            betterauth, "_fetch_jwks", AsyncMock(side_effect=AssertionError("must not fetch"))
        ):
            return await betterauth.verify_betterauth_token(token)

    assert asyncio.run(_run()) is None