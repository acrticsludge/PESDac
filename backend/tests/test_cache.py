"""Unit contract for app/cache.py (spec redis-read-through-cache §6/§8).

Hand-rolled FakeRedis (no new test deps): implements the same
get/setex/delete/scan client protocol the cache module speaks, plus an
error-injection flag for fail-open proof. Imitates the TestClient-free
unit style — no app, no DB here.
"""

from __future__ import annotations

import fnmatch

import pytest

from app import cache


class FakeRedis:
    """In-memory stand-in for the cache client protocol."""

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
def fake():
    client = FakeRedis()
    cache.set_test_client(client)
    yield client
    cache.clear_test_client()


UID = "11111111-2222-3333-4444-555555555555"


def test_key_schema_scopes_user_and_hashes_search_text(fake):
    k1 = cache.chats_list_key(UID, False, "CN", "  TCP Vs UDP ", 50, 0)
    assert UID in k1
    assert "TCP" not in k1 and "tcp" not in k1  # raw search text absent
    # ilike is case-insensitive: case variants share the key (hit-safe).
    assert cache.chats_list_key(UID, False, "CN", "tcp vs udp", 50, 0) == k1
    assert cache.chats_list_key(UID, False, "CN", "other", 50, 0) != k1
    assert cache.chats_list_key(UID, True, "CN", "tcp vs udp", 50, 0) != k1
    for key in (
        cache.msgs_key(UID, "abc123", 50, 0),
        cache.profile_key(UID),
        cache.demos_key(UID),
    ):
        assert UID in key


def test_hit_returns_exact_envelope_and_ttl_passes_through(fake):
    envelope = {"data": [{"code": "abc123"}], "pagination": {"total": 1}}
    key = cache.profile_key(UID)
    assert cache.set_json(key, envelope, 60) == "STORED"
    assert fake.ttls[key] == 60
    outcome, value = cache.get_json(key)
    assert outcome == "HIT"
    assert value == envelope


def test_miss_on_absent_key(fake):
    outcome, value = cache.get_json(cache.profile_key(UID))
    assert outcome == "MISS"
    assert value is None


def test_corrupt_payload_is_miss_not_crash(fake):
    key = cache.profile_key(UID)
    fake.setex(key, 60, "{not-json")
    outcome, value = cache.get_json(key)
    assert outcome == "MISS"
    assert value is None


def test_oversize_envelope_skipped_but_servable(fake):
    key = cache.profile_key(UID)
    big = {"data": "x" * (cache.CACHE_MAX_BYTES + 1)}
    assert cache.set_json(key, big, 60) == "SKIP"
    assert key not in fake.store
    outcome, _ = cache.get_json(key)
    assert outcome == "MISS"


def test_non_serializable_value_skipped(fake):
    key = cache.profile_key(UID)
    assert cache.set_json(key, {"data": {1, 2, 3}}, 60) == "SKIP"


def test_prefix_invalidation_deletes_only_scoped_keys(fake):
    other = "99999999-2222-3333-4444-555555555555"
    cache.set_json(cache.chats_list_key(UID, False, None, None, 50, 0), {"n": 1}, 30)
    cache.set_json(cache.chats_list_key(UID, False, None, None, 50, 5), {"n": 2}, 30)
    cache.set_json(cache.msgs_key(UID, "abc123", 50, 0), {"n": 3}, 60)
    cache.set_json(cache.chats_list_key(other, False, None, None, 50, 0), {"n": 4}, 30)
    removed = cache.invalidate_prefix(cache.chats_list_prefix(UID))
    assert removed == 2
    assert cache.get_json(cache.msgs_key(UID, "abc123", 50, 0))[0] == "HIT"
    assert cache.get_json(cache.chats_list_key(other, False, None, None, 50, 0))[0] == "HIT"


def test_invalidate_exact_single_key(fake):
    key = cache.profile_key(UID)
    cache.set_json(key, {"n": 1}, 60)
    assert cache.invalidate_exact(key) == 1
    assert cache.get_json(key)[0] == "MISS"


def test_fail_open_every_op_survives_a_dead_backend(fake):
    fake.fail = True
    assert cache.get_json(cache.profile_key(UID)) == ("OFF", None)
    assert cache.set_json(cache.profile_key(UID), {"n": 1}, 60) == "OFF"
    assert cache.invalidate_exact(cache.profile_key(UID)) == 0
    assert cache.invalidate_prefix(cache.user_prefix(UID)) == 0
    # read_through still serves from the builder (DB path).
    value, outcome = cache.read_through(
        cache.profile_key(UID), 60, lambda: {"n": 1}
    )
    assert value == {"n": 1}
    assert outcome == "OFF"


def test_read_through_hit_skips_build(fake):
    key = cache.profile_key(UID)
    cache.set_json(key, {"n": 7}, 60)
    calls: list = []
    value, outcome = cache.read_through(key, 60, lambda: calls.append(1) or {"n": 8})
    assert (value, outcome) == ({"n": 7}, "HIT")
    assert calls == []


def test_read_through_miss_builds_and_populates(fake):
    key = cache.profile_key(UID)
    value, outcome = cache.read_through(key, 60, lambda: {"n": 9})
    assert (value, outcome) == ({"n": 9}, "MISS")
    assert cache.get_json(key) == ("HIT", {"n": 9})


def test_disabled_without_url_or_fake(monkeypatch):
    cache.clear_test_client()
    monkeypatch.setattr(cache.config, "UPSTASH_REDIS_REST_URL", None)
    assert cache.is_enabled() is False
    assert cache.get_json("any")[0] == "OFF"


def test_disabled_reports_off_without_serializing(monkeypatch):
    """Enabled-check runs before serialization: when off, even an
    oversize envelope reports OFF (never a misleading SKIP) and pays
    no dumps cost."""
    cache.clear_test_client()
    monkeypatch.setattr(cache.config, "UPSTASH_REDIS_REST_URL", None)
    big = {"data": "x" * (cache.CACHE_MAX_BYTES + 1)}
    assert cache.set_json("k", big, 60) == "OFF"


def test_test_env_never_touches_live_backend(monkeypatch):
    """Hermetic suite: a live URL in the developer's own .env must not
    route suite traffic to real Redis (it would populate real keys and
    observe HITs mid-suite). Under ENV=test only an explicit test fake
    enables the cache."""
    cache.clear_test_client()
    monkeypatch.setattr(
        cache.config, "UPSTASH_REDIS_REST_URL", "https://bogus.invalid"
    )
    monkeypatch.setattr(cache.config, "UPSTASH_REDIS_REST_TOKEN", "bogus")
    assert cache.is_enabled() is False
    assert cache.get_json("k") == ("OFF", None)
    assert cache.set_json("k", {"n": 1}, 60) == "OFF"
    assert cache.invalidate_prefix("pesdac:v1:anything:") == 0


def test_empty_prefix_deletes_nothing_without_io(fake):
    """Empty-prefix SCAN '*' + DEL would wipe the database: it must be
    a no-op that never reaches the store (fail=True proves no I/O)."""
    fake.fail = True
    assert cache.invalidate_prefix("") == 0
