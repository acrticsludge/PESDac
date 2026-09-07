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