"""SQLite-backed TestClient. Fresh schema per test; rate-limit buckets reset.

v6 (Neon Auth): env defaults include NEON_AUTH_JWKS_URL placeholder so
the app factory can boot with validate=False. Real JWKS is monkeypatched
in individual tests via `app.auth.neon._set_loader` / `_add_to_cache`.
"""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("NEON_AUTH_BASE_URL", "https://test.invalid/auth")
os.environ.setdefault("NEON_AUTH_JWKS_URL", "https://test.invalid/jwks")
os.environ.setdefault("FRONTEND_ORIGINS", "http://testserver")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("ENV", "test")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app import rate_limit
from app.db import Base, get_db
from app.main import create_app
from app.models.catalog import SUBJECT_SEEDS, Subject

_engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
_TestingSession = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)


def _override_db():
    db = _TestingSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def client():
    Base.metadata.drop_all(bind=_engine)
    Base.metadata.create_all(bind=_engine)
    db = _TestingSession()
    for code, name in SUBJECT_SEEDS:
        db.add(Subject(code=code, display_name=name))
    db.commit()
    db.close()
    rate_limit.reset()

    app = create_app(validate=False)
    app.dependency_overrides[get_db] = _override_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def dbsession():
    db = _TestingSession()
    try:
        yield db
    finally:
        db.close()


# ---------- v6: Neon JWT helpers (TDD seam) ----------

import time as _time
import uuid as _uuid
from base64 import urlsafe_b64encode as _b64u
from typing import Any as _Any

import jwt as _pyjwt
from cryptography.hazmat.primitives import serialization as _ser
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey as _EdPriv,
    Ed25519PublicKey as _EdPub,
)

from app import config as _config
from app.auth import neon as _neon


@pytest.fixture(scope="session")
def _ed_keypair():
    priv = _EdPriv.generate()
    pub_der = priv.public_key().public_bytes(
        encoding=_ser.Encoding.DER,
        format=_ser.PublicFormat.SubjectPublicKeyInfo,
    )
    return priv, pub_der


def _jwk_for_ed25519(pub_der: bytes, kid: str = "test-kid") -> dict:
    pub = _ser.load_der_public_key(pub_der)
    assert isinstance(pub, _EdPub)
    raw = pub.public_bytes(
        encoding=_ser.Encoding.Raw, format=_ser.PublicFormat.Raw
    )
    return {
        "kty": "OKP",
        "crv": "Ed25519",
        "kid": kid,
        "alg": "EdDSA",
        "x": _b64u(raw).rstrip(b"=").decode(),
    }


@pytest.fixture()
def jwks_seeded(_ed_keypair, monkeypatch):
    priv, pub_der = _ed_keypair
    jwk = _jwk_for_ed25519(pub_der, kid="test-kid")
    monkeypatch.setattr(_config, "NEON_AUTH_JWKS_URL", "https://test.invalid/jwks", raising=False)
    _neon.reset_cache()
    _neon._add_to_cache({"test-kid": jwk})
    _neon._set_loader(lambda url: {"test-kid": jwk})
    yield priv
    _neon.reset_cache()


def make_jwt(priv, *, sub: str | None = None, email: str = "user@example.com",
             name: str = "User", kid: str = "test-kid") -> str:
    return _pyjwt.encode(
        {
            "sub": sub or ("neon-sub-" + _uuid.uuid4().hex[:8]),
            "email": email,
            "name": name,
            "iat": int(_time.time()),
            "exp": int(_time.time()) + 3600,
        },
        priv, algorithm="EdDSA", headers={"kid": kid},
    )


@pytest.fixture()
def auth_header(jwks_seeded):
    """Returns a function: (sub=..., email=...) -> {'Authorization': 'Bearer ...'}."""
    def _make(sub: str | None = None, email: str = "user@example.com", name: str = "User") -> dict[str, str]:
        return {"Authorization": f"Bearer {make_jwt(jwks_seeded, sub=sub, email=email, name=name)}"}
    return _make
