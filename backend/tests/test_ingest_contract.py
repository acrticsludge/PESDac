"""Ingest contract T8 (spec §6.1): origin/auth/rate/curator/422/idempotency.

Curator gate is env-driven (CURATOR_AUTH_IDS): the same test user is
curator when listed, non-curator when not — proves the gate without
extra identity fixtures.
"""

from __future__ import annotations

import fnmatch

import pytest

from app import cache
from app.deps import get_current_user


class FakeRedis:
    def __init__(self):
        self.store: dict[str, str] = {}

    def get(self, key: str):
        return self.store.get(key)

    def setex(self, key: str, ttl_s: int, value: str):
        self.store[key] = value
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
def curator_env(monkeypatch):
    monkeypatch.setenv("CURATOR_AUTH_IDS", "test-auth-user-id")
    monkeypatch.setenv("RETRIEVAL_EMBED_PROVIDER", "hash")
    monkeypatch.setenv("R2_PUBLIC_BASE", "https://media.example/")


def _payload(**over):
    base = {
        "manifest_version": 1,
        "subject": "CN",
        "unit": "unit-1",
        "source": {
            "kind": "slides",
            "title": "Unit 1 slides",
            "r2_key": "subjects/CN/unit-1/slides.pdf",
            "public_url": "https://media.example/subjects/CN/unit-1/slides.pdf",
            "page_count": 2,
        },
        "chunks": [
            {"kind": "text", "page": 1, "text": "alpha",
             "page_url": "https://media.example/subjects/CN/unit-1/pages/p001.png"},
            {"kind": "text", "page": 2, "text": "beta",
             "page_url": "https://media.example/subjects/CN/unit-1/pages/p002.png"},
        ],
    }
    base.update(over)
    return base


def test_unauthenticated_is_401_envelope(client):
    client.app.dependency_overrides.pop(get_current_user, None)
    r = client.post("/api/v1/ingest/manifest", json=_payload())
    assert r.status_code == 401
    assert r.json()["error"]["code"] in ("UNAUTHORIZED", "FORBIDDEN")


def test_foreign_origin_rejected(client, curator_env):
    r = client.post(
        "/api/v1/ingest/manifest", json=_payload(),
        headers={"Origin": "https://evil.example"},
    )
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "FORBIDDEN"


def test_non_curator_gets_403_curator_only(client, monkeypatch):
    monkeypatch.setenv("CURATOR_AUTH_IDS", "someone-else@example.com")
    monkeypatch.setenv("RETRIEVAL_EMBED_PROVIDER", "hash")
    monkeypatch.setenv("R2_PUBLIC_BASE", "https://media.example/")
    r = client.post("/api/v1/ingest/manifest", json=_payload())
    assert r.status_code == 403
    body = r.json()["error"]
    assert body["code"] == "CURATOR_ONLY"
    assert body["message"] == "Only curators can add course material."


def test_curator_ingest_persists_source_chunks_and_event(client, curator_env, dbsession):
    from app.models.retrieval import IngestEvent, RetrievalChunk, RetrievalSource

    r = client.post("/api/v1/ingest/manifest", json=_payload())
    assert r.status_code == 201, r.text
    body = r.json()
    assert "source_id" in body and body["chunk_count"] == 2
    assert dbsession.query(RetrievalSource).count() == 1
    assert dbsession.query(RetrievalChunk).count() == 2
    assert dbsession.query(IngestEvent).count() == 1
    src = dbsession.query(RetrievalSource).one()
    assert src.public_url == "https://media.example/subjects/CN/unit-1/slides.pdf"
    assert src.version == 1


def test_subject_mismatch_is_422(client, curator_env):
    bad = _payload()
    bad["subject"] = "OS"
    r = client.post("/api/v1/ingest/manifest", json=_payload(**bad))
    assert r.status_code == 422


def test_idempotent_repost_returns_200_with_same_source(client, curator_env, dbsession):
    from app.models.retrieval import RetrievalChunk, RetrievalSource

    h = {"x-client-ingest-key": "key-123"}
    first = client.post("/api/v1/ingest/manifest", json=_payload(), headers=h)
    assert first.status_code == 201, first.text
    second = client.post("/api/v1/ingest/manifest", json=_payload(), headers=h)
    assert second.status_code == 200
    assert second.json()["source_id"] == first.json()["source_id"]
    assert dbsession.query(RetrievalSource).count() == 1
    assert dbsession.query(RetrievalChunk).count() == 2


def test_reingest_without_key_replaces_chunks_and_bumps_version(
    client, curator_env, dbsession
):
    from app.models.retrieval import RetrievalChunk, RetrievalSource

    assert client.post("/api/v1/ingest/manifest", json=_payload()).status_code == 201
    payload2 = _payload()
    payload2["chunks"] = [payload2["chunks"][0]]
    r = client.post("/api/v1/ingest/manifest", json=payload2)
    assert r.status_code == 201
    assert dbsession.query(RetrievalSource).one().version == 2
    assert dbsession.query(RetrievalChunk).count() == 1


def test_nothing_persisted_on_embed_failure(client, curator_env, dbsession, monkeypatch):
    from app.models.retrieval import RetrievalSource
    from app.retrieval import embeddings as emb_mod
    import app.routers.ingest as ingest_mod

    class Dead:
        dims = 1024
        name = "workers-ai"
        model = "baai/bge-m3"

        def embed(self, texts):
            raise emb_mod.EmbedUnreachable("down")

    monkeypatch.setattr(ingest_mod, "_active_provider", lambda: Dead())
    before = dbsession.query(RetrievalSource).count()
    r = client.post("/api/v1/ingest/manifest", json=_payload())
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "EMBED_UNREACHABLE"
    assert dbsession.query(RetrievalSource).count() == before


def test_commit_conflict_never_500s(client, curator_env, monkeypatch):
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy.orm import Session as SASession

    # Warm up so the test-user row exists outside the patched window.
    assert client.get("/api/v1/auth/me").status_code == 200
    real_commit = SASession.commit
    calls = {"n": 0}

    def flaky_commit(self):
        calls["n"] += 1
        if calls["n"] == 1:
            raise IntegrityError("INSERT INTO ingest_events", {}, Exception("duplicate"))
        return real_commit(self)

    monkeypatch.setattr(SASession, "commit", flaky_commit)
    r = client.post(
        "/api/v1/ingest/manifest", json=_payload(),
        headers={"x-client-ingest-key": "race-k"},
    )
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "INGEST_CONFLICT"


def test_ingest_wipes_subject_evidence_cache(client, curator_env):
    fake = FakeRedis()
    cache.set_test_client(fake)
    try:
        key = cache.retrieval_result_key("CN", ["slides"], 10, "q")
        cache.set_json(key, {"data": []}, 300)
        assert client.post("/api/v1/ingest/manifest", json=_payload()).status_code == 201
        assert cache.get_json(key)[0] == "MISS"
    finally:
        cache.clear_test_client()
