"""Validate leg T9 (spec §6.1b): identical verdicts, zero writes."""

from __future__ import annotations

import pytest


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
        ],
    }
    base.update(over)
    return base


def test_validate_ok_writes_nothing(client, curator_env, dbsession):
    from app.models.retrieval import IngestEvent, RetrievalChunk, RetrievalSource

    before = (
        dbsession.query(RetrievalSource).count(),
        dbsession.query(RetrievalChunk).count(),
        dbsession.query(IngestEvent).count(),
    )
    r = client.post("/api/v1/ingest/validate", json=_payload())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["chunk_count"] == 1
    assert isinstance(body["warnings"], list)
    after = (
        dbsession.query(RetrievalSource).count(),
        dbsession.query(RetrievalChunk).count(),
        dbsession.query(IngestEvent).count(),
    )
    assert after == before


def test_validate_mirrors_manifest_verdicts(client, curator_env, dbsession):
    bad_subject = _payload()
    bad_subject["subject"] = "XX"
    assert client.post("/api/v1/ingest/validate", json=bad_subject).status_code == 422
    assert client.post("/api/v1/ingest/manifest", json=bad_subject).status_code == 422

    bad_url = _payload()
    bad_url["chunks"][0]["page_url"] = "https://evil.example/p.png"
    assert client.post("/api/v1/ingest/validate", json=bad_url).status_code == 422
    assert client.post("/api/v1/ingest/manifest", json=bad_url).status_code == 422

    from app.models.retrieval import RetrievalSource

    assert dbsession.query(RetrievalSource).count() == 0


def test_validate_requires_curator(client, monkeypatch):
    monkeypatch.setenv("CURATOR_AUTH_IDS", "someone-else@example.com")
    monkeypatch.setenv("R2_PUBLIC_BASE", "https://media.example/")
    r = client.post("/api/v1/ingest/validate", json=_payload())
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "CURATOR_ONLY"
