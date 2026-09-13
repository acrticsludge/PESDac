"""Message-window cache (K2, TTL 60 s) + append/truncate/delete/clear
invalidation (spec §5). Self-contained fixture (see test_cache_chats.py).
"""

from __future__ import annotations

import fnmatch

import pytest
from fastapi import Depends, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app import cache, rate_limit
from app.db import Base, get_db
from app.deps import get_current_user
from app.main import create_app
from app.models.catalog import SUBJECT_SEEDS, Subject
from app.models.users import User


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}
        self.ttls: dict[str, int] = {}
        self.fail = False

    def _check(self):
        if self.fail:
            raise ConnectionError("fake-redis-down")

    def get(self, key: str):
        self._check()
        return self.store.get(key)

    def setex(self, key: str, ttl_s: int, value: str):
        self._check()
        self.store[key] = value
        self.ttls[key] = ttl_s
        return True

    def delete(self, *keys: str):
        self._check()
        removed = 0
        for key in keys:
            if key in self.store:
                del self.store[key]
                self.ttls.pop(key, None)
                removed += 1
        return removed

    def scan(self, cursor="0", match="*", count=100):
        self._check()
        keys = sorted(k for k in self.store if fnmatch.fnmatch(k, match))
        return 0, keys


@pytest.fixture()
def pair():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(
        bind=engine, autoflush=False, expire_on_commit=False
    )
    db = TestingSession()
    for code, name in SUBJECT_SEEDS:
        db.add(Subject(code=code, display_name=name))
    db.commit()
    db.close()
    rate_limit.reset()

    def _override_db():
        session = TestingSession()
        try:
            yield session
        finally:
            session.close()

    def _override_user(request: Request, db: Session = Depends(get_db)):
        token = (request.headers.get("authorization") or "").replace("Bearer ", "").strip()
        sub = token or "user-a"
        user = db.query(User).filter(User.auth_user_id == sub).first()
        if not user:
            user = User(
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
    app.dependency_overrides[get_current_user] = _override_user
    fake = FakeRedis()
    cache.set_test_client(fake)
    with TestClient(app) as client:
        yield client, fake
    cache.clear_test_client()
    app.dependency_overrides.clear()


def _h(user: str = "user-a") -> dict[str, str]:
    return {"Authorization": f"Bearer {user}"}


def _mkchat(client: TestClient) -> str:
    r = client.post(
        "/api/v1/chats", json={"subject": "CN", "title": "t"}, headers=_h()
    )
    assert r.status_code == 201, r.text
    return r.json()["code"]


def _append(client: TestClient, code: str, text: str = "hello", key=None):
    body = {"role": "user", "content": {"text": text}}
    if key is not None:
        body["clientMsgKey"] = key
    return client.post(f"/api/v1/chats/{code}/messages", json=body, headers=_h())


def test_window_reread_is_hit_with_identical_envelope(pair):
    client, _ = pair
    code = _mkchat(client)
    _append(client, code)
    first = client.get(f"/api/v1/chats/{code}/messages", headers=_h())
    assert first.headers["X-Cache"] == "MISS"
    second = client.get(f"/api/v1/chats/{code}/messages", headers=_h())
    assert second.headers["X-Cache"] == "HIT"
    assert second.json() == first.json()
    assert second.json()["pagination"]["total"] == 1


def test_window_pages_key_independently(pair):
    client, _ = pair
    code = _mkchat(client)
    _append(client, code)
    _append(client, code, text="second")
    assert client.get(
        f"/api/v1/chats/{code}/messages", params={"limit": 1, "offset": 0}, headers=_h()
    ).headers["X-Cache"] == "MISS"
    r = client.get(
        f"/api/v1/chats/{code}/messages", params={"limit": 1, "offset": 1}, headers=_h()
    )
    assert r.headers["X-Cache"] == "MISS"
    assert r.json()["data"][0]["seq"] == 1
    assert r.json()["pagination"]["total"] == 2


def test_append_busts_window_and_list(pair):
    client, _ = pair
    code = _mkchat(client)
    _append(client, code)
    client.get(f"/api/v1/chats/{code}/messages", headers=_h())
    assert client.get(f"/api/v1/chats/{code}/messages", headers=_h()).headers["X-Cache"] == "HIT"
    client.get("/api/v1/chats", headers=_h())
    assert client.get("/api/v1/chats", headers=_h()).headers["X-Cache"] == "HIT"
    _append(client, code, text="new turn")
    window = client.get(f"/api/v1/chats/{code}/messages", headers=_h())
    assert window.headers["X-Cache"] == "MISS"
    assert window.json()["pagination"]["total"] == 2
    listing = client.get("/api/v1/chats", headers=_h())
    assert listing.headers["X-Cache"] == "MISS"
    assert listing.json()["data"][0]["msgCount"] == 2
    assert listing.json()["data"][0]["lastSeq"] == 1


def test_truncate_busts_window_and_list(pair):
    client, _ = pair
    code = _mkchat(client)
    _append(client, code)
    _append(client, code, text="two")
    client.get(f"/api/v1/chats/{code}/messages", headers=_h())
    assert client.get(f"/api/v1/chats/{code}/messages", headers=_h()).headers["X-Cache"] == "HIT"
    r = client.delete(
        f"/api/v1/chats/{code}/messages", params={"from_seq": 1}, headers=_h()
    )
    assert r.status_code == 200, r.text
    window = client.get(f"/api/v1/chats/{code}/messages", headers=_h())
    assert window.headers["X-Cache"] == "MISS"
    assert window.json()["pagination"]["total"] == 1


def test_unknown_code_404s_are_never_cached(pair):
    client, _ = pair
    for _ in range(2):
        r = client.get("/api/v1/chats/zzzzzz/messages", headers=_h())
        assert r.status_code == 404
        assert r.headers["X-Cache"] == "MISS"


def test_keyed_replay_append_stays_duplicate_free(pair):
    client, _ = pair
    code = _mkchat(client)
    first = _append(client, code, key="k-1")
    assert first.status_code == 201, first.text
    replay = _append(client, code, key="k-1")
    assert replay.status_code == 200
    assert replay.json()["id"] == first.json()["id"]
    window = client.get(f"/api/v1/chats/{code}/messages", headers=_h())
    assert window.json()["pagination"]["total"] == 1


def test_delete_chat_busts_its_windows(pair):
    client, fake = pair
    code = _mkchat(client)
    _append(client, code)
    client.get(f"/api/v1/chats/{code}/messages", headers=_h())
    stale = [k for k in fake.store if f"msgs:{code}:" in k]
    assert stale, "setup: window key must exist before delete"
    # Unrelated scope must survive the wipe (precision, not just blast).
    client.get("/api/v1/profiles/me", headers=_h())
    assert client.delete(f"/api/v1/chats/{code}", headers=_h()).status_code == 204
    assert [k for k in fake.store if f"msgs:{code}:" in k] == []
    assert client.get("/api/v1/chats", headers=_h()).headers["X-Cache"] == "MISS"
    assert client.get("/api/v1/profiles/me", headers=_h()).headers["X-Cache"] == "HIT"


def test_window_isolated_per_user(pair):
    client, _ = pair
    code = _mkchat(client)
    _append(client, code)
    first = client.get(f"/api/v1/chats/{code}/messages", headers=_h("user-a"))
    assert first.headers["X-Cache"] == "MISS"
    # Same code as another user: cross-user 404 (no existence oracle),
    # never served from A's cache, never stored under B.
    denied = client.get(f"/api/v1/chats/{code}/messages", headers=_h("user-b"))
    assert denied.status_code == 404
    assert denied.headers["X-Cache"] == "MISS"
    second = client.get(f"/api/v1/chats/{code}/messages", headers=_h("user-a"))
    assert second.headers["X-Cache"] == "HIT"
    assert second.json()["pagination"]["total"] == 1


def test_fail_open_window_serves_from_db(pair):
    client, fake = pair
    code = _mkchat(client)
    _append(client, code)
    fake.fail = True
    r = client.get(f"/api/v1/chats/{code}/messages", headers=_h())
    assert r.status_code == 200
    assert r.headers["X-Cache"] == "OFF"
    assert r.json()["pagination"]["total"] == 1
