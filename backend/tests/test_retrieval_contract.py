"""Retrieval contract T11 (spec §6.2/§6.3, §9)."""

from __future__ import annotations

import pytest

from app.deps import get_current_user


@pytest.fixture()
def search_env(monkeypatch):
    monkeypatch.setenv("RETRIEVAL_EMBED_PROVIDER", "hash")
    monkeypatch.setenv("R2_PUBLIC_BASE", "https://media.example/")
    monkeypatch.setenv("CURATOR_AUTH_IDS", "test-auth-user-id")


def _search(query="what is tcp?", subject="CN", **over):
    body = {"query": query, "subject": subject}
    body.update(over)
    return body


def _seed_payload():
    return {
        "manifest_version": 1,
        "subject": "CN",
        "unit": "unit-1",
        "source": {
            "kind": "slides", "title": "S",
            "r2_key": "subjects/CN/unit-1/s.pdf",
            "public_url": "https://media.example/subjects/CN/unit-1/s.pdf",
            "page_count": 1,
        },
        "chunks": [
            {"kind": "text", "page": 1, "text": "bridge rectifier output",
             "page_url": "https://media.example/subjects/CN/unit-1/pages/p1.png"},
            {"kind": "text", "page": 2, "text": "unrelated paragraph",
             "page_url": "https://media.example/subjects/CN/unit-1/pages/p2.png"},
        ],
    }


def _seed_cn_corpus(client):
    r = client.post("/api/v1/ingest/manifest", json=_seed_payload())
    assert r.status_code == 201, r.text


def test_search_requires_auth(client):
    client.app.dependency_overrides.pop(get_current_user, None)
    r = client.post("/api/v1/retrieval/search", json=_search())
    assert r.status_code == 401


def test_search_validates_subject_scope_topk(client, search_env):
    assert client.post(
        "/api/v1/retrieval/search", json=_search(subject="XX")).status_code == 422
    assert client.post(
        "/api/v1/retrieval/search",
        json=_search(scope=["nope"])).status_code == 422
    assert client.post(
        "/api/v1/retrieval/search", json=_search(topK=0)).status_code == 422
    assert client.post(
        "/api/v1/retrieval/search", json=_search(topK=21)).status_code == 422
    assert client.post(
        "/api/v1/retrieval/search", json=_search(query="")).status_code == 422
    assert client.post(
        "/api/v1/retrieval/search",
        json=_search(query="x" * 2001)).status_code == 422


def test_empty_corpus_returns_empty_data(client, search_env):
    r = client.post("/api/v1/retrieval/search", json=_search())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["data"] == []
    assert body["pagination"]["total"] == 0


def test_seeded_search_is_deterministic(client, search_env):
    _seed_cn_corpus(client)
    first = client.post(
        "/api/v1/retrieval/search", json=_search("bridge rectifier output")).json()
    second = client.post(
        "/api/v1/retrieval/search", json=_search("bridge rectifier output")).json()
    assert first == second
    assert first["data"][0]["text"] == "bridge rectifier output"


def test_user_image_payload_rejected(client, search_env):
    r = client.post(
        "/api/v1/retrieval/search",
        json={**_search(), "image_bytes": "abc"},
    )
    assert r.status_code == 422


def test_mixed_stamps_give_space_mismatch(client, search_env, dbsession):
    _seed_cn_corpus(client)
    from app.models.retrieval import RetrievalChunk

    victim = dbsession.query(RetrievalChunk).first()
    victim.embed_provider = "other-provider"
    dbsession.commit()
    r = client.post("/api/v1/retrieval/search", json=_search("bridge"))
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "EMBED_SPACE_MISMATCH"


def test_restamp_roundtrip_recovers_to_200(client, search_env, dbsession):
    _seed_cn_corpus(client)
    from app.models.retrieval import RetrievalChunk

    victim = dbsession.query(RetrievalChunk).first()
    victim.embed_provider = "other-provider"
    dbsession.commit()
    assert client.post(
        "/api/v1/retrieval/search", json=_search("bridge")).status_code == 503
    r = client.post("/api/v1/ingest/manifest", json=_seed_payload())
    assert r.status_code == 201, r.text
    ok = client.post("/api/v1/retrieval/search", json=_search("bridge"))
    assert ok.status_code == 200


def test_search_rate_limit_shape(client, search_env):
    from app import rate_limit as rl_mod

    rl_mod.reset()
    last = None
    for _ in range(61):
        last = client.post("/api/v1/retrieval/search", json=_search("q"))
    assert last.status_code == 429
    assert last.json()["error"]["code"] == "RATE_LIMITED"
    assert "Retry-After" in last.headers


def test_health_shape_and_counts(client, search_env):
    r = client.get("/api/v1/retrieval/health")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dims"] == 1024
    assert body["sources"] == 0 and body["chunks"] == 0
    assert "neurons_24h_estimate" in body
    _seed_cn_corpus(client)
    r2 = client.get("/api/v1/retrieval/health")
    assert r2.status_code == 200
    assert r2.json()["chunks"] == 2
