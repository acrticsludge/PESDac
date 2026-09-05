"""Chats contract (v6 — Neon JWT auth): CRUD, pin/archive, search, pagination, ownership."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _create(client: TestClient, subject="CN", title="OSI model"):
    r = client.post("/api/v1/chats", json={"subject": subject, "title": title})
    assert r.status_code == 201, r.text
    return r.json()


def test_chats_unauthenticated(client):
    assert client.get("/api/v1/chats").status_code == 401


def test_chats_create_trims_and_validates(client, auth_header):
    client.headers.update(auth_header(email="a@example.com"))
    chat = _create(client, title="  TCP vs UDP  ")
    assert chat["title"] == "TCP vs UDP"
    assert len(chat["code"]) == 6
    assert client.post("/api/v1/chats", json={"subject": "XX", "title": "t"}).status_code == 422
    assert client.post("/api/v1/chats", json={"subject": "CN", "title": "   "}).status_code == 422


def test_chats_list_search_filter_pagination(client, auth_header):
    client.headers.update(auth_header(email="a@example.com"))
    _create(client, subject="CN", title="TCP vs UDP")
    _create(client, subject="OS", title="Deadlocks")
    _create(client, subject="CN", title="Routing deep dive")
    r = client.get("/api/v1/chats")
    assert r.json()["pagination"]["total"] == 3
    r = client.get("/api/v1/chats", params={"q": "tcp"})
    assert r.json()["pagination"]["total"] == 1
    r = client.get("/api/v1/chats", params={"subject": "OS"})
    assert r.json()["pagination"]["total"] == 1
    r = client.get("/api/v1/chats", params={"limit": 2, "offset": 0})
    assert len(r.json()["data"]) == 2
    assert r.json()["pagination"]["total"] == 3


def test_chats_rename_pin_archive_unpin_semantics(client, auth_header):
    client.headers.update(auth_header(email="a@example.com"))
    chat = _create(client)
    code = chat["code"]
    r = client.patch(f"/api/v1/chats/{code}", json={"title": "Renamed"})
    assert r.json()["title"] == "Renamed"
    r = client.patch(f"/api/v1/chats/{code}", json={"isPinned": True})
    assert r.json()["isPinned"] is True
    # Archiving unpins (matches archiveChat).
    r = client.patch(f"/api/v1/chats/{code}", json={"isArchived": True})
    assert r.json()["isArchived"] is True
    assert r.json()["isPinned"] is False
    assert client.get("/api/v1/chats").json()["pagination"]["total"] == 0
    assert client.get("/api/v1/chats", params={"archived": True}).json()["pagination"]["total"] == 1
    r = client.patch(f"/api/v1/chats/{code}", json={"isArchived": False})
    assert r.json()["isArchived"] is False


def test_chats_delete_and_clear_keep_profile(client, auth_header):
    client.headers.update(auth_header(email="a@example.com"))
    code = _create(client)["code"]
    assert client.delete(f"/api/v1/chats/{code}").status_code == 204
    assert client.delete("/api/v1/chats/nope99").status_code == 404
    _create(client, title="one")
    _create(client, title="two")
    r = client.delete("/api/v1/chats")
    assert r.json()["deleted"] == 2
    assert client.get("/api/v1/profiles/me").status_code == 200


def test_chats_cross_user_is_404_no_oracle(client, auth_header):
    # User A creates a chat.
    client.headers.update(auth_header(sub="neon-sub-a", email="a@example.com"))
    code = _create(client)["code"]
    # Switch to user B (different sub).
    client.headers.update(auth_header(sub="neon-sub-b", email="b@example.com"))
    assert client.get("/api/v1/chats").json()["pagination"]["total"] == 0
    assert client.patch(f"/api/v1/chats/{code}", json={"title": "x"}).status_code == 404
    assert client.delete(f"/api/v1/chats/{code}").status_code == 404
