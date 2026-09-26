"""Cache namespace isolation for retrieval (spec retrieval-phase1 §8/@9).

Shared corpus keys must survive account wipe; ingest subject-wipe must
leave rate-limit + lock keys intact. Retrieval keys carry digests only
(no raw query text) and no user scope (all-subjects-visible assumption).
"""

from __future__ import annotations

import fnmatch

import pytest

from app import cache


class FakeRedis:
    """In-memory stand-in for the cache client protocol (mirrors test_cache.py)."""

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


UID = "11111111-2222-3333-4444-555555555555"


def test_retrieval_result_key_carries_digest_not_raw_query(fake):
    key = cache.retrieval_result_key("CN", ["slides", "textbook"], 10, "  bridge   RECTIFIER? ")
    assert "bridge" not in key.lower()
    assert "RECTIFIER" not in key
    # Whitespace/case normalization: variants share the key (hit-safe).
    assert key == cache.retrieval_result_key("CN", ["textbook", "slides"], 10, "bridge RECTIFIER?")
    assert key != cache.retrieval_result_key("CN", ["slides", "textbook"], 10, "other query")
    assert key != cache.retrieval_result_key("CN", ["slides", "textbook"], 5, "bridge RECTIFIER?")
    assert key != cache.retrieval_result_key("OS", ["slides", "textbook"], 10, "bridge RECTIFIER?")


def test_retrieval_result_key_has_no_user_scope(fake):
    key = cache.retrieval_result_key("CN", ["slides"], 10, "what is tcp?")
    assert UID not in key
    assert "{u:" not in key


def test_retrieval_emb_key_digests_text_per_provider(fake):
    k1 = cache.retrieval_emb_key("workers-ai", "hello world")
    assert "hello" not in k1
    assert k1 == cache.retrieval_emb_key("workers-ai", "hello world")
    assert k1 != cache.retrieval_emb_key("workers-ai", "other text")
    assert k1 != cache.retrieval_emb_key("nvidia", "hello world")


def test_account_wipe_preserves_shared_corpus_keys(fake):
    corpus_key = cache.retrieval_result_key("CN", ["slides"], 10, "what is tcp?")
    emb_key = cache.retrieval_emb_key("workers-ai", "what is tcp?")
    cache.set_json(corpus_key, {"data": []}, 300)
    cache.set_json(emb_key, [0.1, 0.2], 86400)
    cache.set_json(cache.profile_key(UID), {"n": 1}, 60)
    # Account delete wipes the whole user prefix (routers/users.py).
    removed = cache.invalidate_prefix(cache.user_prefix(UID))
    assert removed == 1
    assert cache.get_json(corpus_key)[0] == "HIT"
    assert cache.get_json(emb_key)[0] == "HIT"
    assert cache.get_json(cache.profile_key(UID))[0] == "MISS"


def test_ingest_subject_wipe_preserves_rate_limit_and_lock_keys(fake):
    cn_key = cache.retrieval_result_key("CN", ["slides"], 10, "q1")
    os_key = cache.retrieval_result_key("OS", ["slides"], 10, "q1")
    cache.set_json(cn_key, {"data": [1]}, 300)
    cache.set_json(os_key, {"data": [2]}, 300)
    rl_key = cache.rate_limit_key("retrieval-search", "127.0.0.1")
    lock_key = cache.lock_key("purge")
    fake.store[rl_key] = "3"
    fake.store[lock_key] = "token"
    removed = cache.invalidate_prefix(cache.retrieval_prefix("CN"))
    assert removed == 1
    assert cache.get_json(cn_key)[0] == "MISS"
    assert cache.get_json(os_key)[0] == "HIT"
    assert fake.store[rl_key] == "3"
    assert fake.store[lock_key] == "token"


def test_retrieval_helpers_fail_open_when_backend_down(fake):
    fake.fail = True
    key = cache.retrieval_result_key("CN", ["slides"], 10, "q")
    assert cache.get_json(key) == ("OFF", None)
    assert cache.set_json(key, {"data": []}, 300) == "OFF"
    assert cache.invalidate_prefix(cache.retrieval_prefix("CN")) == 0
    value, outcome = cache.read_through(key, 300, lambda: {"data": []})
    assert value == {"data": []}
    assert outcome == "OFF"
