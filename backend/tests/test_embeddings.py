"""Embedder T5: protocol + hash provider + cache + dims guard (spec §7)."""

from __future__ import annotations

import fnmatch

import pytest

from app import cache


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}
        self.ttls: dict[str, int] = {}
        self.calls = {"get": 0}

    def get(self, key: str):
        self.calls["get"] += 1
        return self.store.get(key)

    def setex(self, key: str, ttl_s: int, value: str):
        self.store[key] = value
        self.ttls[key] = ttl_s
        return True

    def delete(self, *keys: str):
        removed = 0
        for key in keys:
            if key in self.store:
                del self.store[key]
                removed += 1
        return removed

    def scan(self, cursor="0", match="*", count=100):
        keys = sorted(k for k in self.store if fnmatch.fnmatch(k, match))
        return 0, keys

    def incr(self, key: str):
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


def test_hash_provider_is_deterministic_1024d(fake):
    from app.retrieval.embeddings import HashProvider

    p = HashProvider()
    assert p.dims == 1024
    assert p.name == "hash"
    a = p.embed(["hello world"])
    b = p.embed(["hello world"])
    assert a == b
    assert len(a[0]) == 1024
    assert p.embed(["other text"]) != a


def test_embed_texts_uses_cache_on_repeat(fake):
    from app.retrieval.embeddings import HashProvider, embed_texts

    p = HashProvider()
    first = embed_texts(p, ["cache me"])
    key = cache.retrieval_emb_key("hash", "cache me")
    assert key in fake.store
    gets_before = fake.calls["get"]
    second = embed_texts(p, ["cache me"])
    assert second == first
    assert fake.calls["get"] == gets_before + 1


def test_embed_texts_rejects_wrong_dims(fake):
    from app.retrieval.embeddings import HashProvider, embed_texts

    class BadDims(HashProvider):
        dims = 384

    with pytest.raises(ValueError):
        embed_texts(BadDims(), ["hello"])
