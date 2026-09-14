"""Redis-backed rate limiting + distributed locks (skills gap fix).

Hand-rolled FakeRedis with the extended protocol (incr/expire/ttl/set_nx):
no new test deps, no app, no DB — unit style like test_cache.py.
"""

from __future__ import annotations

import pytest

from app import cache


class FakeRedis:
    def __init__(self):
        self.counters: dict[str, int] = {}
        self.ttls: dict[str, int] = {}
        self.locks: dict[str, str] = {}
        self.fail = False

    def _check(self):
        if self.fail:
            raise ConnectionError("fake-redis-down")

    # cache protocol (unused here, present for shape parity)
    def get(self, key: str):
        self._check()
        return None

    def setex(self, key: str, ttl_s: int, value: str):
        self._check()
        return True

    def delete(self, *keys: str):
        self._check()
        removed = 0
        for key in keys:
            if key in self.locks:
                del self.locks[key]
                removed += 1
        return removed

    def scan(self, cursor="0", match="*", count=100):
        self._check()
        return "0", []

    # rate-limit / lock protocol
    def incr(self, key: str):
        self._check()
        self.counters[key] = self.counters.get(key, 0) + 1
        return self.counters[key]

    def expire(self, key: str, ttl_s: int):
        self._check()
        self.ttls[key] = int(ttl_s)
        return True

    def ttl(self, key: str):
        self._check()
        return self.ttls.get(key, -2)

    def set_nx(self, key: str, value: str, ttl_s: int):
        self._check()
        if key in self.locks:
            return False
        self.locks[key] = value
        self.ttls[key] = int(ttl_s)
        return True


@pytest.fixture()
def fake():
    client = FakeRedis()
    cache.set_test_client(client)
    yield client
    cache.clear_test_client()


def test_incr_expire_ttl_contract(fake: FakeRedis):
    assert fake.incr("rl:a") == 1
    assert fake.expire("rl:a", 60) is True
    assert fake.ttl("rl:a") == 60
    assert fake.incr("rl:a") == 2


def test_rate_limit_key_namespaced():
    key = cache.rate_limit_key("chats-create", "127.0.0.1")
    assert key.startswith(cache.CACHE_PREFIX + ":rl:chats-create:")
    assert "127.0.0.1" in key


def test_acquire_release_lock(fake: FakeRedis):
    key = cache.lock_key("purge")
    assert cache.acquire_lock(key, "tok1", 60) is True
    # second holder blocked (SET NX NULL shape)
    assert cache.acquire_lock(key, "tok2", 60) is False
    cache.release_lock(key)
    assert cache.acquire_lock(key, "tok2", 60) is True


def test_acquire_lock_fail_closed_on_outage(fake: FakeRedis):
    fake.fail = True
    assert cache.acquire_lock(cache.lock_key("purge"), "tok", 60) is False
    # release must not raise when Redis is down
    cache.release_lock(cache.lock_key("purge"))


class _StubClient:
    host = "10.0.0.9"


class _StubUrl:
    path = "/api/v1/profiles/me"


class _StubRequest:
    client = _StubClient()
    headers: dict = {}
    url = _StubUrl()

    def __init__(self):
        self.headers = {}


def test_check_uses_redis_fixed_window_then_429(fake: FakeRedis):
    from app import rate_limit

    rate_limit.reset()
    req = _StubRequest()
    for _ in range(3):
        assert rate_limit.check("probe-route", req, 3, 60) is None
    limited = rate_limit.check("probe-route", req, 3, 60)
    assert limited is not None and limited.status_code == 429
    assert limited.headers["Retry-After"] == "60"


def test_check_falls_back_to_memory_on_redis_outage(fake: FakeRedis):
    from app import rate_limit

    rate_limit.reset()
    fake.fail = True  # every Redis op raises → memory buckets decide
    req = _StubRequest()
    for _ in range(2):
        assert rate_limit.check("probe-fallback", req, 2, 60) is None
    limited = rate_limit.check("probe-fallback", req, 2, 60)
    assert limited is not None and limited.status_code == 429
