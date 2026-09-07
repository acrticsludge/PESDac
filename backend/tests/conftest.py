"""SQLite-backed TestClient. Fresh schema per test; rate-limit buckets reset.

BetterAuth migration: Tests mock BetterAuth JWT verification via dependency override.
"""

from __future__ import annotations

import os
import uuid

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
from app.deps import get_current_user
from app.main import create_app
from app.models.catalog import SUBJECT_SEEDS, Subject
from app.models.users import User

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
    # Override get_current_user to return a test user
    from fastapi import Depends
    test_user_id = uuid.uuid4()
    test_auth_user_id = "test-auth-user-id"
    
    def _override_get_current_user(db=Depends(get_db)):
        user = db.query(User).filter(User.auth_user_id == test_auth_user_id).first()
        if not user:
            user = User(
                id=test_user_id,
                auth_user_id=test_auth_user_id,
                email="test@example.com",
                display_name="Test User",
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        return user
    
    app.dependency_overrides[get_current_user] = _override_get_current_user
    
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


@pytest.fixture()
def auth_header():
    """Returns a function that makes auth headers for the test user.

    Since we override get_current_user, the Authorization header is not
    actually validated - it's just for test shape compatibility.
    """
    def _make(sub: str | None = None, email: str = "test@example.com", name: str = "Test User") -> dict[str, str]:
        return {"Authorization": "Bearer test-token"}
    return _make