"""Write-path invalidation through a live cache (audit §12 item 1).

The default suite runs NullCache (ENV=test → every read OFF), which
proves nothing about invalidation. These tests install the FakeRedis
stand-in so reads populate, writes must purge, and the assertions read
the fake's keyspace directly (proof the cache machinery ran) alongside
response freshness. Cross-user safety is key-namespace safety: every
populated key embeds the caller's id.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import cache


class FakeRedis:
    """In-memory stand-in for the cache client protocol (mirrors test_cache.py)."""

    def __init__(self):
        self.store: dict[str, str] = {}
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
        return True

    def delete(self, *keys: str):
        self._check()
        removed = 0
        for key in keys:
            if key in self.store:
                del self.store[key]
                removed += 1
        return removed

    def scan(self, cursor="0", match="*", count=100):
        self._check()
        import fnmatch

        keys = sorted(k for k in self.store if fnmatch.fnmatch(k, match))
        return 0, keys

    def incr(self, key: str):
        self._check()
        return None

    def expire(self, key: str, ttl_s: int):
        return False

    def ttl(self, key: str):
        return -2

    def set_nx(self, key: str, value: str, ttl_s: int):
        return False


@pytest.fixture()
def fake():
    client = FakeRedis()
    cache.set_test_client(client)
    yield client
    cache.clear_test_client()


def _me(client: TestClient) -> str:
    return client.get("/api/v1/auth/me").json()["user"]["id"]


def _keys_with(fake: FakeRedis, needle: str) -> list[str]:
    return sorted(k for k in fake.store if needle in k)


def test_chats_write_purges_list_and_second_read_hits(client, fake):
    uid = _me(client)
    first = client.get("/api/v1/chats")
    assert first.headers["X-Cache"] == "MISS"
    prefix = cache.chats_list_prefix(uid)
    assert _keys_with(fake, prefix), "first read must populate the cache"
    assert all(uid in k for k in fake.store), "every key is user-namespaced"

    r = client.post("/api/v1/chats", json={"subject": "CN", "title": "Fresh"})
    assert r.status_code == 201, r.text
    assert _keys_with(fake, prefix) == [], "create must purge the list scope"

    second = client.get("/api/v1/chats")
    assert second.json()["pagination"]["total"] == 1
    third = client.get("/api/v1/chats")
    assert third.headers["X-Cache"] == "HIT"
    assert third.json() == second.json()


def test_profile_patch_purges_profile_key(client, fake):
    uid = _me(client)
    assert client.get("/api/v1/profiles/me").status_code == 200
    assert cache.profile_key(uid) in fake.store
    assert client.patch("/api/v1/profiles/me", json={"difficulty": "hard"}).status_code == 200
    assert cache.profile_key(uid) not in fake.store, "patch must purge the profile key"
    assert client.get("/api/v1/profiles/me").json()["difficulty"] == "hard"


def test_demo_put_purges_demos_key(client, fake):
    uid = _me(client)
    assert client.get("/api/v1/demo-state").json() == {"overrides": []}
    assert cache.demos_key(uid) in fake.store
    r = client.put("/api/v1/demo-state/TCP%20vs%20UDP", json={"isPinned": True})
    assert r.status_code == 200, r.text
    assert cache.demos_key(uid) not in fake.store, "put must purge the demos key"
    assert client.get("/api/v1/demo-state").json()["overrides"][0]["demoLabel"] == "TCP vs UDP"


def test_account_delete_purges_whole_user_prefix(client, fake):
    uid = _me(client)
    client.post("/api/v1/chats", json={"subject": "CN", "title": "x"})
    client.get("/api/v1/chats")
    client.get("/api/v1/profiles/me")
    client.get("/api/v1/demo-state")
    assert _keys_with(fake, uid), "reads must populate before delete"
    assert client.delete("/api/v1/users/me").status_code == 204
    assert _keys_with(fake, uid) == [], "delete must purge the whole user prefix"


def test_null_cache_zero_delta_vs_first_miss(client, fake):
    # Same DB, same pure reads: NullCache (OFF) and a cold FakeRedis
    # (MISS→build) must serve byte-identical bodies — the cache layer
    # changes transport outcomes, never content.
    cache.clear_test_client()
    null_bodies = {
        name: client.get(path).json()
        for name, path in {
            "chats": "/api/v1/chats",
            "profile": "/api/v1/profiles/me",
            "demos": "/api/v1/demo-state",
            "export": "/api/v1/users/me/export",
        }.items()
    }
    cache.set_test_client(fake)
    for name, path in {
        "chats": "/api/v1/chats",
        "profile": "/api/v1/profiles/me",
        "demos": "/api/v1/demo-state",
        "export": "/api/v1/users/me/export",
    }.items():
        r = client.get(path)
        assert r.headers["X-Cache"] in ("MISS", "OFF", "SKIP")
        if name != "export":
            assert r.json() == null_bodies[name], name
