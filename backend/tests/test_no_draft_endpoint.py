"""Drafts stay tab-memory-only (audit §10 item 4, D6).

No draft endpoint exists and no draft payload may grow one: the
frontend `readDraft`/`writeDraft` pair is memory-only (pinned by
`session-store.test.ts`), and this file pins the server half — no
route, no OpenAPI path, no envelope mentioning drafts.
"""

from __future__ import annotations


def test_no_draft_routes(client):
    assert client.get("/api/v1/drafts").status_code == 404
    assert client.post("/api/v1/drafts", json={"text": "hi"}).status_code == 404


def test_openapi_has_no_draft_paths(client):
    r = client.get("/api/openapi.json")
    assert r.status_code == 200, r.text
    paths = r.json()["paths"]
    assert not [p for p in paths if "draft" in p], [p for p in paths if "draft" in p]
