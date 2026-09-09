"""Display-name re-mirror (display-name-edit FR2, human-approved).

BetterAuth owns the display name; a rename via POST /api/auth/update-user
moves only the JWT `name` claim. get_current_user re-mirrors the verified
claim into users.display_name (write-only-on-diff), so GET /auth/me
converges without a reload or schema change.

These tests drive the REAL get_current_user (the shared `client` fixture
overrides it) with verify_betterauth_token monkeypatched, on a private
SQLite database.
"""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("FRONTEND_ORIGINS", "http://testserver")
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("ENV", "test")
os.environ.setdefault("BETTER_AUTH_URL", "http://localhost:4321")
os.environ.setdefault("BETTER_AUTH_SECRET", "test-secret-32-characters-long!!")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app import rate_limit
from app.db import Base, get_db
from app.main import create_app


@pytest.fixture()
def mirror_client(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def _override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    claims = {
        "sub": "sub-rename-1",
        "email": "rename@example.com",
        "name": "Old Name",
    }

    async def fake_verify(token):
        assert token == "rename-token"
        return dict(claims)

    monkeypatch.setattr("app.deps.verify_betterauth_token", fake_verify)

    rate_limit.reset()
    app = create_app(validate=False)
    app.dependency_overrides[get_db] = _override_db
    with TestClient(app) as c:
        yield c, claims
    app.dependency_overrides.clear()


def _me(mirror_client):
    c, _ = mirror_client
    r = c.get("/api/v1/auth/me", headers={"Authorization": "Bearer rename-token"})
    assert r.status_code == 200, r.text
    return r.json()["user"]


def test_me_seeds_display_name_on_first_seen_claim(mirror_client):
    assert _me(mirror_client)["displayName"] == "Old Name"


def test_me_remirrors_after_betterauth_rename(mirror_client):
    c, claims = mirror_client
    assert _me(mirror_client)["displayName"] == "Old Name"
    claims["name"] = "Renamed User"
    assert _me(mirror_client)["displayName"] == "Renamed User"
    # Converged: a repeat read still agrees (no churn, no reload needed).
    assert _me(mirror_client)["displayName"] == "Renamed User"


def test_empty_claim_never_wipes_stored_name(mirror_client):
    c, claims = mirror_client
    assert _me(mirror_client)["displayName"] == "Old Name"
    claims["name"] = ""
    assert _me(mirror_client)["displayName"] == "Old Name"


def test_remirror_truncates_to_80(mirror_client):
    c, claims = mirror_client
    claims["name"] = "n" * 100
    assert _me(mirror_client)["displayName"] == "n" * 80
