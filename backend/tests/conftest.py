"""SQLite-backed TestClient. Fresh schema per test; rate-limit buckets reset."""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "test-secret-32-bytes-long-abcdef")
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


def signup(client: TestClient, email: str = "you@example.com", password: str = "correct-horse-12345", name: str = ""):
    r = client.post("/api/v1/auth/signup", json={"email": email, "password": password, "displayName": name})
    assert r.status_code == 201, r.text
    return r.json()["user"]


def auth_client(client: TestClient, email: str = "you@example.com") -> TestClient:
    signup(client, email=email)
    return client
