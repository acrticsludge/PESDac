"""Chats contract (BetterAuth migration): CRUD, pin/archive, search, pagination, ownership."""

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
def soft_client():
    """Non-raising TestClient: unhandled route exceptions come back as
    the 500 envelope (proving the global handler) instead of raising
    in the test thread. Mirrors the conftest client otherwise."""
    Base.metadata.drop_all(bind=_engine)
    Base.metadata.create_all(bind=_engine)
    db = _TestingSession()
    for code, name in SUBJECT_SEEDS:
        db.add(Subject(code=code, display_name=name))
    db.commit()
    db.close()
    rate_limit.reset()

    def _override_get_current_user(db=Depends(get_db)):
        user = db.query(User).filter(User.auth_user_id == "test-auth-user-id").first()
        if not user:
            user = User(
                id=uuid.uuid4(),
                auth_user_id="test-auth-user-id",
                email="test@example.com",
                display_name="Test User",
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        return user

    app = create_app(validate=False)
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = _override_get_current_user
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c
    app.dependency_overrides.clear()


def _create(client: TestClient, subject="CN", title="OSI model"):
    r = client.post("/api/v1/chats", json={"subject": subject, "title": title})
    assert r.status_code == 201, r.text
    return r.json()


def test_chats_create_trims_and_validates(client):
    chat = _create(client, title="  TCP vs UDP  ")
    assert chat["title"] == "TCP vs UDP"
    assert len(chat["code"]) == 6
    assert client.post("/api/v1/chats", json={"subject": "XX", "title": "t"}).status_code == 422
    assert client.post("/api/v1/chats", json={"subject": "CN", "title": "   "}).status_code == 422


def test_chats_list_search_filter_pagination(client):
    _create(client, subject="CN", title="TCP vs UDP")
    _create(client, subject="OS", title="Deadlocks")
    _create(client, subject="CN", title="Routing deep dive")
    r = client.get("/api/v1/chats")
    assert r.json()["pagination"]["total"] == 3
    r = client.get("/api/v1/chats", params={"q": "tcp"})
    assert r.json()["pagination"]["total"] == 1
    r = client.get("/api/v1/chats", params={"subject": "OS"})
    assert r.json()["pagination"]["total"] == 1
    r = client.get("/api/v1/chats", params={"limit": 2, "offset": 0})
    assert len(r.json()["data"]) == 2
    assert r.json()["pagination"]["total"] == 3


def test_chats_rename_pin_archive_unpin_semantics(client):
    chat = _create(client)
    code = chat["code"]
    r = client.patch(f"/api/v1/chats/{code}", json={"title": "Renamed"})
    assert r.json()["title"] == "Renamed"
    r = client.patch(f"/api/v1/chats/{code}", json={"isPinned": True})
    assert r.json()["isPinned"] is True
    # Archiving unpins (matches archiveChat).
    r = client.patch(f"/api/v1/chats/{code}", json={"isArchived": True})
    assert r.json()["isArchived"] is True
    assert r.json()["isPinned"] is False
    assert client.get("/api/v1/chats").json()["pagination"]["total"] == 0
    assert client.get("/api/v1/chats", params={"archived": True}).json()["pagination"]["total"] == 1
    r = client.patch(f"/api/v1/chats/{code}", json={"isArchived": False})
    assert r.json()["isArchived"] is False


def test_chats_delete_and_clear_keep_profile(client):
    code = _create(client)["code"]
    assert client.delete(f"/api/v1/chats/{code}").status_code == 204
    assert client.delete("/api/v1/chats/nope99").status_code == 404
    _create(client, title="one")
    _create(client, title="two")
    r = client.delete("/api/v1/chats")
    # Slice 13: clear_chats now returns the standard {data, pagination}
    # envelope (was {deleted: N}). The frontend consumer in lib/auth.ts
    # already accepts a generic T for apiFetch, so the consumer side
    # picks up `body.data.deleted` here.
    body = r.json()
    assert body["data"]["deleted"] == 2
    assert body["pagination"]["total"] == 2
    assert client.get("/api/v1/profiles/me").status_code == 200


def test_chats_list_pagination_typed(client):
    # Slice 13: the response's pagination field is now a typed
    # Pydantic model (Pagination: {limit, offset, total}), not a
    # bare dict. OpenAPI documents it and the consumer can rely on
    # the exact shape.
    _create(client, title="one")
    r = client.get("/api/v1/chats", params={"limit": 5, "offset": 0})
    p = r.json()["pagination"]
    assert set(p.keys()) == {"limit", "offset", "total"}
    assert p["limit"] == 5
    assert p["offset"] == 0
    assert p["total"] == 1


def test_chats_single_dev_user_sees_own_chats(client):
    # TODO(BetterAuth): restore the cross-user 404 oracle test once real
    # per-user sessions land. Single dev-user placeholder: created chats
    # are visible to the same caller.
    code = _create(client)["code"]
    assert client.get("/api/v1/chats").json()["pagination"]["total"] == 1
    assert client.patch(f"/api/v1/chats/{code}", json={"title": "x"}).status_code == 200


def test_chat_create_rejects_unknown_fields_and_bad_lengths(client):
    # §9 item 1: ChatCreate now forbids extras like every other input
    # schema — unknown fields fail loudly instead of being dropped.
    r = client.post(
        "/api/v1/chats", json={"subject": "CN", "title": "t", "owner": "mallory"}
    )
    assert r.status_code == 422, r.text
    # 35 chars > 34-col title budget.
    r = client.post("/api/v1/chats", json={"subject": "CN", "title": "x" * 35})
    assert r.status_code == 422, r.text
    # Patch path: overlong + unknown field.
    code = _create(client)["code"]
    assert client.patch(f"/api/v1/chats/{code}", json={"title": "y" * 35}).status_code == 422
    assert client.patch(f"/api/v1/chats/{code}", json={"subject": "OS"}).status_code == 422
    # Adopt key over budget.
    r = client.post(
        "/api/v1/chats",
        json={"subject": "CN", "title": "t", "clientAdoptKey": "k" * 65},
    )
    assert r.status_code == 422, r.text


def test_clear_chats_empty_is_retry_safe(client):
    # §9 item 3: delete-all on an empty account is a clean 200 with
    # zero deleted — safe to retry, profile untouched.
    for _ in range(2):
        r = client.delete("/api/v1/chats")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["data"] == {"deleted": 0}
        assert body["pagination"]["total"] == 0
    assert client.get("/api/v1/profiles/me").status_code == 200


def test_delete_account_twice_is_204_both_times(client):
    # §9 item 3: the second DELETE finds no row (or a re-upserted empty
    # one) and still answers 204 — the frontend retry-after-partial
    # contract holds.
    assert client.delete("/api/v1/users/me").status_code == 204
    assert client.delete("/api/v1/users/me").status_code == 204


def test_create_commit_outage_answers_500_not_409_and_recovers(soft_client, monkeypatch):
    # §13: a dead database must not masquerade as a code collision
    # (409 would send the client retrying codes against a dead DB), and
    # the rolled-back session must not wedge later requests.
    from sqlalchemy.orm import Session as SASession

    def _boom(self):
        raise RuntimeError("db down")

    monkeypatch.setattr(SASession, "commit", _boom)
    r = soft_client.post("/api/v1/chats", json={"subject": "CN", "title": "t"})
    assert r.status_code == 500, r.text
    assert r.json()["error"]["code"] == "INTERNAL"
    assert "Reference:" in r.json()["error"]["message"]
    monkeypatch.undo()
    r = soft_client.post("/api/v1/chats", json={"subject": "CN", "title": "t"})
    assert r.status_code == 201, r.text
