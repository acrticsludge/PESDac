"""Chat-list cache (K1, TTL 30 s) + write-through invalidation (spec §5).

Self-contained app fixture (imitates conftest, adds a per-token user
override for isolation proof + a FakeRedis test backend). DAMP by
intent — each test_cache_* file stands alone.
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


def _h(user: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {user}"}


def _create(client: TestClient, user="user-a", title=" Gershwin "):
    r = client.post(
        "/api/v1/chats", json={"subject": "CN", "title": title}, headers=_h(user)
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_list_second_read_is_hit_with_identical_body(pair):
    client, _ = pair
    _create(client)
    first = client.get("/api/v1/chats", headers=_h("user-a"))
    assert first.headers["X-Cache"] == "MISS"
    second = client.get("/api/v1/chats", headers=_h("user-a"))
    assert second.headers["X-Cache"] == "HIT"
    assert second.json() == first.json()


def test_list_filter_variants_key_independently(pair):
    client, _ = pair
    _create(client, title="TCP vs UDP")
    assert client.get("/api/v1/chats", headers=_h("user-a")).headers["X-Cache"] == "MISS"
    # Same filter, different case: ilike is case-insensitive → shared key.
    r = client.get("/api/v1/chats", params={"q": "TCP"}, headers=_h("user-a"))
    assert r.headers["X-Cache"] == "MISS"
    r = client.get("/api/v1/chats", params={"q": "tcp"}, headers=_h("user-a"))
    assert r.headers["X-Cache"] == "HIT"
    assert r.json()["pagination"]["total"] == 1
    # Different filter → independent key.
    r = client.get("/api/v1/chats", params={"subject": "OS"}, headers=_h("user-a"))
    assert r.headers["X-Cache"] == "MISS"
    assert r.json()["pagination"]["total"] == 0


def test_create_invalidates_list(pair):
    client, _ = pair
    assert client.get("/api/v1/chats", headers=_h("user-a")).headers["X-Cache"] == "MISS"
    assert client.get("/api/v1/chats", headers=_h("user-a")).headers["X-Cache"] == "HIT"
    _create(client, title="fresh")
    r = client.get("/api/v1/chats", headers=_h("user-a"))
    assert r.headers["X-Cache"] == "MISS"
    assert r.json()["pagination"]["total"] == 1


def test_patch_invalidates_list(pair):
    client, _ = pair
    code = _create(client)["code"]
    client.get("/api/v1/chats", headers=_h("user-a"))
    assert client.get("/api/v1/chats", headers=_h("user-a")).headers["X-Cache"] == "HIT"
    assert client.patch(
        f"/api/v1/chats/{code}", json={"title": "Renamed"}, headers=_h("user-a")
    ).status_code == 200
    r = client.get("/api/v1/chats", headers=_h("user-a"))
    assert r.headers["X-Cache"] == "MISS"
    assert r.json()["data"][0]["title"] == "Renamed"


def test_delete_invalidates_list(pair):
    client, _ = pair
    code = _create(client)["code"]
    client.get("/api/v1/chats", headers=_h("user-a"))
    assert client.delete(f"/api/v1/chats/{code}", headers=_h("user-a")).status_code == 204
    r = client.get("/api/v1/chats", headers=_h("user-a"))
    assert r.headers["X-Cache"] == "MISS"
    assert r.json()["pagination"]["total"] == 0


def test_clear_invalidates_list(pair):
    client, _ = pair
    _create(client, title="one")
    _create(client, title="two")
    client.get("/api/v1/chats", headers=_h("user-a"))
    assert client.delete("/api/v1/chats", headers=_h("user-a")).status_code == 200
    r = client.get("/api/v1/chats", headers=_h("user-a"))
    assert r.headers["X-Cache"] == "MISS"
    assert r.json()["pagination"]["total"] == 0


def test_per_user_isolation(pair):
    client, _ = pair
    _create(client, user="user-a", title="Alpha private")
    first_a = client.get("/api/v1/chats", headers=_h("user-a"))
    assert first_a.headers["X-Cache"] == "MISS"
    first_b = client.get("/api/v1/chats", headers=_h("user-b"))
    assert first_b.headers["X-Cache"] == "MISS"
    assert first_b.json()["pagination"]["total"] == 0
    # A's cached list still serves A — and never leaks to B.
    second_a = client.get("/api/v1/chats", headers=_h("user-a"))
    assert second_a.headers["X-Cache"] == "HIT"
    assert second_a.json()["data"][0]["title"] == "Alpha private"


def test_fail_open_dead_backend_serves_from_db(pair):
    client, fake = pair
    _create(client)
    fake.fail = True
    r = client.get("/api/v1/chats", headers=_h("user-a"))
    assert r.status_code == 200
    assert r.headers["X-Cache"] == "OFF"
    assert r.json()["pagination"]["total"] == 1
    r = client.post(
        "/api/v1/chats",
        json={"subject": "CN", "title": "still works"},
        headers=_h("user-a"),
    )
    assert r.status_code == 201
    assert r.headers["X-Cache"] == "OFF"


def test_mutations_carry_off_header(pair):
    client, _ = pair
    code = _create(client)["code"]
    assert client.get("/api/v1/chats", headers=_h("user-a")).headers["X-Cache"] == "MISS"
    r = client.patch(
        f"/api/v1/chats/{code}", json={"title": "x"}, headers=_h("user-a")
    )
    assert r.headers["X-Cache"] == "OFF"


def test_adopt_replay_busts_list_without_duplicating(pair):
    client, _ = pair
    body = {"subject": "CN", "title": "guest", "clientAdoptKey": "adopt-1"}
    r1 = client.post("/api/v1/chats", json=body, headers=_h("user-a"))
    assert r1.status_code == 201, r1.text
    assert client.get("/api/v1/chats", headers=_h("user-a")).headers["X-Cache"] == "MISS"
    assert client.get("/api/v1/chats", headers=_h("user-a")).headers["X-Cache"] == "HIT"
    # Keyed replay: conflict-200 on the same row, list busted, still one row.
    r2 = client.post("/api/v1/chats", json=body, headers=_h("user-a"))
    assert r2.status_code == 200
    assert r2.json()["code"] == r1.json()["code"]
    r = client.get("/api/v1/chats", headers=_h("user-a"))
    assert r.headers["X-Cache"] == "MISS"
    assert r.json()["pagination"]["total"] == 1
