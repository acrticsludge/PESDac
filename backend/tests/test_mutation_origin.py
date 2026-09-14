"""Mutation-origin policy (audit §16 item 1, CLAUDE.md §24 CORS row).

Exact-match allowlist against FRONTEND_ORIGINS (http://testserver in
tests): allowlisted Origin passes, foreign Origin 403s with the
envelope (never a CORS-shaped confusion), absent Origin/Referer
passes (non-browser clients), Referer-only is honored the same way,
and prefix-matching bypasses (`testserver.evil.com`) fail.
"""

from __future__ import annotations

ALLOWLISTED = {"Origin": "http://testserver"}
FOREIGN = {"Origin": "http://evil.example"}
PREFIX_TRICK = {"Origin": "http://testserver.evil.example"}


def test_allowlisted_origin_passes(client):
    r = client.post(
        "/api/v1/chats", json={"subject": "CN", "title": "t"}, headers=ALLOWLISTED
    )
    assert r.status_code == 201, r.text


def test_foreign_origin_rejected_with_envelope(client):
    r = client.post(
        "/api/v1/chats", json={"subject": "CN", "title": "t"}, headers=FOREIGN
    )
    assert r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "FORBIDDEN"


def test_prefix_bypass_rejected(client):
    r = client.post(
        "/api/v1/chats", json={"subject": "CN", "title": "t"}, headers=PREFIX_TRICK
    )
    assert r.status_code == 403, r.text


def test_absent_origin_passes_for_non_browser_clients(client):
    r = client.post("/api/v1/chats", json={"subject": "CN", "title": "t"})
    assert r.status_code == 201, r.text


def test_referer_only_honored(client):
    ok = client.post(
        "/api/v1/chats",
        json={"subject": "CN", "title": "t"},
        headers={"Referer": "http://testserver/some/page"},
    )
    assert ok.status_code == 201, ok.text
    bad = client.post(
        "/api/v1/chats",
        json={"subject": "CN", "title": "t"},
        headers={"Referer": "http://evil.example/x"},
    )
    assert bad.status_code == 403, bad.text
    assert bad.json()["error"]["code"] == "FORBIDDEN"


def test_origin_verdict_applies_to_all_mutations(client):
    code = client.post("/api/v1/chats", json={"subject": "CN", "title": "t"}).json()["code"]
    assert client.patch(f"/api/v1/chats/{code}", json={"title": "x"}, headers=FOREIGN).status_code == 403
    assert client.delete(f"/api/v1/chats/{code}", headers=FOREIGN).status_code == 403
    assert (
        client.post(
            f"/api/v1/chats/{code}/messages",
            json={"role": "user", "content": {"t": "hi"}},
            headers=FOREIGN,
        ).status_code
        == 403
    )
    assert client.delete("/api/v1/users/me", headers=FOREIGN).status_code == 403
