"""Profile (K3, 60 s) + demos (K4, 120 s) read-through, single-key DELs,
whole-prefix wipe on DELETE /users/me, and proof that /auth/me, export,
health/ready are untouched. Self-contained fixture (see test_cache_chats.py).
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
from app import cache, rate_limit, timing
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
    # Same wiring prod gets in get_engine: without this the timing
    # split reads zeros (see test_timing.py no-install path).
    timing.install_engine_timing(engine)
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


def test_profile_first_read_provisions_through_miss_then_hits(pair):
    client, _ = pair
    # Brand-new user: no profile row exists — the miss path provisions it.
    first = client.get("/api/v1/profiles/me", headers=_h("fresh-user"))
    assert first.status_code == 200
    assert first.headers["X-Cache"] == "MISS"
    second = client.get("/api/v1/profiles/me", headers=_h("fresh-user"))
    assert second.headers["X-Cache"] == "HIT"
    assert second.json() == first.json()


def test_hit_skips_profile_select_but_never_identity_upsert(pair):
    """Calibrated expectation (spec §12): FastAPI resolves
    get_current_user before the route body, so a HIT still pays the
    identity upsert statement — the cache skips the profile select,
    never the identity RTT."""
    client, _ = pair
    client.get("/api/v1/profiles/me", headers=_h("fresh-user"))  # provisions
    r = client.patch(
        "/api/v1/profiles/me", json={"difficulty": "hard"}, headers=_h("fresh-user")
    )
    assert r.status_code == 200, r.text
    miss = client.get("/api/v1/profiles/me", headers=_h("fresh-user"))
    assert miss.headers["X-Cache"] == "MISS"
    assert int(miss.headers["X-Db-Queries"]) == 2  # user + profile
    hit = client.get("/api/v1/profiles/me", headers=_h("fresh-user"))
    assert hit.headers["X-Cache"] == "HIT"
    assert int(hit.headers["X-Db-Queries"]) == 1  # user upsert only


def test_profile_patch_busts_single_key(pair):
    client, _ = pair
    client.get("/api/v1/profiles/me", headers=_h())
    assert client.get("/api/v1/profiles/me", headers=_h()).headers["X-Cache"] == "HIT"
    r = client.patch(
        "/api/v1/profiles/me", json={"difficulty": "hard"}, headers=_h()
    )
    assert r.status_code == 200, r.text
    reread = client.get("/api/v1/profiles/me", headers=_h())
    assert reread.headers["X-Cache"] == "MISS"
    assert reread.json()["difficulty"] == "hard"


def test_demo_put_busts_demos_list(pair):
    client, _ = pair
    first = client.get("/api/v1/demo-state", headers=_h())
    assert first.headers["X-Cache"] == "MISS"
    assert client.get("/api/v1/demo-state", headers=_h()).headers["X-Cache"] == "HIT"
    r = client.put(
        "/api/v1/demo-state/TCP vs UDP",
        json={"isPinned": True},
        headers=_h(),
    )
    assert r.status_code == 200, r.text
    reread = client.get("/api/v1/demo-state", headers=_h())
    assert reread.headers["X-Cache"] == "MISS"
    assert reread.json()["overrides"][0]["isPinned"] is True


def test_account_delete_wipes_whole_user_prefix(pair):
    client, fake = pair
    client.get("/api/v1/profiles/me", headers=_h())
    client.get("/api/v1/demo-state", headers=_h())
    client.get("/api/v1/chats", headers=_h())
    assert len(fake.store) == 3
    assert client.delete("/api/v1/users/me", headers=_h()).status_code == 204
    assert fake.store == {}


def test_untouched_paths_never_hit(pair):
    client, _ = pair
    # /auth/me, export, health/ready have no cache code paths: re-reads
    # must never report HIT.
    assert client.get("/api/v1/auth/me", headers=_h()).status_code == 200
    assert client.get("/api/v1/auth/me", headers=_h()).headers["X-Cache"] != "HIT"
    assert client.get("/api/v1/users/me/export", headers=_h()).status_code == 200
    assert client.get("/api/v1/users/me/export", headers=_h()).headers["X-Cache"] != "HIT"
    assert client.get("/api/v1/health").headers["X-Cache"] != "HIT"
    assert client.get("/api/v1/ready").headers["X-Cache"] != "HIT"


def test_untouched_paths_survive_dead_backend(pair):
    client, fake = pair
    fake.fail = True
    assert client.get("/api/v1/auth/me", headers=_h()).status_code == 200
    assert client.get("/api/v1/users/me/export", headers=_h()).status_code == 200
    assert client.get("/api/v1/ready").status_code == 200
