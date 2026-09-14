"""Cross-user isolation proof (audit §9 item 2).

Fulfills the TODO at the bottom of test_chats_contract.py: per-user
sessions HAVE landed (BetterAuth), so the oracle test is restored for
real. One app, two identities — the override switches `sub` mid-test
and every user-owned route must answer 404 (never 403-differentiated
existence) for the other user's resources, while each identity's own
data stays intact.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi import Depends
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
def pair():
    """One app, two identities. `who["sub"]` switches the caller."""
    Base.metadata.drop_all(bind=_engine)
    Base.metadata.create_all(bind=_engine)
    db = _TestingSession()
    for code, name in SUBJECT_SEEDS:
        db.add(Subject(code=code, display_name=name))
    db.commit()
    db.close()
    rate_limit.reset()

    who = {"sub": "user-a-sub"}

    def _override_get_current_user(db=Depends(get_db)):
        sub = who["sub"]
        user = db.query(User).filter(User.auth_user_id == sub).first()
        if not user:
            user = User(
                id=uuid.uuid4(),
                auth_user_id=sub,
                email=f"{sub}@example.com",
                display_name=sub,
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        return user

    app = create_app(validate=False)
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_get_current_user
    with TestClient(app) as c:
        yield c, who
    app.dependency_overrides.clear()


def _as(who, sub):
    who["sub"] = sub


def test_cross_user_chat_routes_all_404_never_403(pair):
    client, who = pair
    code = client.post("/api/v1/chats", json={"subject": "CN", "title": "A private"}).json()["code"]
    client.post(f"/api/v1/chats/{code}/messages", json={"role": "user", "content": {"t": "hi"}})
    _as(who, "user-b-sub")
    assert client.patch(f"/api/v1/chats/{code}", json={"title": "hijack"}).status_code == 404
    assert client.delete(f"/api/v1/chats/{code}").status_code == 404
    r = client.get(f"/api/v1/chats/{code}/messages")
    assert r.status_code == 404, r.text
    r = client.post(f"/api/v1/chats/{code}/messages", json={"role": "user", "content": {"t": "hi"}})
    assert r.status_code == 404, r.text
    r = client.delete(f"/api/v1/chats/{code}/messages", params={"from_seq": 0})
    assert r.status_code == 404, r.text
    # No response differentiates "missing" from "someone else's".
    for resp in (
        client.patch(f"/api/v1/chats/{code}", json={"title": "x"}),
        client.get(f"/api/v1/chats/{code}/messages"),
    ):
        assert resp.status_code != 403
        assert resp.json()["error"]["code"] == "NOT_FOUND"
    # A's rows are untouched by B's attempts.
    _as(who, "user-a-sub")
    assert client.get("/api/v1/chats").json()["pagination"]["total"] == 1


def test_cross_user_demo_profile_export_scoped(pair):
    client, who = pair
    client.put("/api/v1/demo-state/TCP%20vs%20UDP", json={"isPinned": True})
    client.patch("/api/v1/profiles/me", json={"difficulty": "hard"})
    _as(who, "user-b-sub")
    # B sees none of A's state: no overrides, default profile, empty export.
    assert client.get("/api/v1/demo-state").json() == {"overrides": []}
    assert client.get("/api/v1/profiles/me").json()["difficulty"] == "medium"
    body = client.get("/api/v1/users/me/export").json()
    assert body["chats"] == []
    assert body["demoState"] == []
    assert body["profile"]["difficulty"] == "medium"


def test_cross_user_delete_only_deletes_self(pair):
    client, who = pair
    client.post("/api/v1/chats", json={"subject": "CN", "title": "A keeps this"})
    _as(who, "user-b-sub")
    assert client.delete("/api/v1/users/me").status_code == 204
    _as(who, "user-a-sub")
    assert client.get("/api/v1/chats").json()["pagination"]["total"] == 1
