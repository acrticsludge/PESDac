"""Messages contract (spec §3.2): append/list/truncate, seq assignment,
ownership 404s (no oracle), 100KB cap, role/content validation."""

from __future__ import annotations

from datetime import datetime

from fastapi.testclient import TestClient

NOT_FOUND = {"error": {"code": "NOT_FOUND", "message": "Chat not found."}}


def _create_chat(client: TestClient, subject="CN", title="OSI model"):
    r = client.post("/api/v1/chats", json={"subject": subject, "title": title})
    assert r.status_code == 201, r.text
    return r.json()


def _append(client: TestClient, code: str, role="user", content=None):
    return client.post(
        f"/api/v1/chats/{code}/messages",
        json={"role": role, "content": {"text": "hello"} if content is None else content},
    )


def test_messages_append_assigns_seq_and_returns_message_out(client):
    code = _create_chat(client)["code"]
    first = _append(client, code, role="user").json()
    assert set(first.keys()) == {"id", "seq", "role", "content", "createdAt"}
    assert (first["seq"], first["role"]) == (0, "user")
    assert first["content"] == {"text": "hello"}
    second = _append(client, code, role="assistant").json()
    assert second["seq"] == 1
    assert second["role"] == "assistant"
    datetime.fromisoformat(first["createdAt"])  # tz-aware ISO wire format


def test_messages_list_returns_seq_ascending_slice_envelope(client):
    code = _create_chat(client)["code"]
    _append(client, code, role="user")
    _append(client, code, role="assistant")
    _append(client, code, role="system", content={"n": 1})
    body = client.get(f"/api/v1/chats/{code}/messages").json()
    assert [m["seq"] for m in body["data"]] == [0, 1, 2]
    assert body["pagination"] == {"limit": 200, "offset": 0, "total": 3}
    body = client.get(f"/api/v1/chats/{code}/messages", params={"limit": 2, "offset": 1}).json()
    assert [m["seq"] for m in body["data"]] == [1, 2]
    assert body["pagination"] == {"limit": 2, "offset": 1, "total": 3}


def test_messages_list_rejects_limit_over_max(client):
    code = _create_chat(client)["code"]
    assert client.get(f"/api/v1/chats/{code}/messages", params={"limit": 201}).status_code == 422


def test_messages_truncate_deletes_tail_only(client):
    code = _create_chat(client)["code"]
    for _ in range(3):
        _append(client, code)
    r = client.delete(f"/api/v1/chats/{code}/messages", params={"from_seq": 2})
    assert r.status_code == 200, r.text
    # Truncate mirrors the clear_chats {data, pagination} envelope.
    assert r.json() == {
        "data": {"deleted": 1},
        "pagination": {"limit": 0, "offset": 0, "total": 1},
    }
    body = client.get(f"/api/v1/chats/{code}/messages").json()
    assert [m["seq"] for m in body["data"]] == [0, 1]


def test_messages_truncate_from_zero_clears_all(client):
    code = _create_chat(client)["code"]
    _append(client, code)
    r = client.delete(f"/api/v1/chats/{code}/messages", params={"from_seq": 0})
    assert r.json()["data"] == {"deleted": 1}
    assert client.get(f"/api/v1/chats/{code}/messages").json()["data"] == []


def test_messages_truncate_rejects_negative_or_missing_from_seq(client):
    code = _create_chat(client)["code"]
    assert client.delete(f"/api/v1/chats/{code}/messages", params={"from_seq": -1}).status_code == 422
    assert client.delete(f"/api/v1/chats/{code}/messages").status_code == 422


def test_messages_cross_user_code_404s_without_oracle(client, dbsession):
    from app.models.chats import Chat
    from app.models.users import User

    other = User(auth_user_id="other-user-id", email="other@example.com", display_name="Other")
    dbsession.add(other)
    dbsession.commit()
    dbsession.add(Chat(user_id=other.id, code="zzzz99", subject="CN", title="Other"))
    dbsession.commit()
    assert client.get("/api/v1/chats/zzzz99/messages").status_code == 404
    assert client.get("/api/v1/chats/zzzz99/messages").json() == NOT_FOUND
    assert _append(client, "zzzz99").status_code == 404
    assert _append(client, "zzzz99").json() == NOT_FOUND
    r = client.delete("/api/v1/chats/zzzz99/messages", params={"from_seq": 0})
    assert r.status_code == 404
    assert r.json() == NOT_FOUND


def test_messages_demo_and_unknown_codes_404_identically(client):
    for code in ("OSI%20Model", "nope99"):
        assert client.get(f"/api/v1/chats/{code}/messages").json() == NOT_FOUND
        assert _append(client, code).json() == NOT_FOUND
        r = client.delete(f"/api/v1/chats/{code}/messages", params={"from_seq": 0})
        assert r.json() == NOT_FOUND


def test_messages_rejects_oversize_content(client):
    code = _create_chat(client)["code"]
    big = {"text": "x" * (100 * 1024 + 1)}
    r = _append(client, code, content=big)
    assert r.status_code == 422, r.text


def test_messages_rejects_bad_role_and_non_object_content(client):
    code = _create_chat(client)["code"]
    assert _append(client, code, role="hacker").status_code == 422
    r = client.post(f"/api/v1/chats/{code}/messages", json={"role": "user", "content": [1, 2]})
    assert r.status_code == 422, r.text
    r = client.post(f"/api/v1/chats/{code}/messages", json={"role": "user", "content": "nope"})
    assert r.status_code == 422, r.text


def test_messages_append_touches_chat_updated_at(client):
    before = _create_chat(client)
    code = before["code"]
    assert _append(client, code).status_code == 201
    after = client.get("/api/v1/chats").json()["data"][0]
    assert datetime.fromisoformat(after["updatedAt"]) >= datetime.fromisoformat(before["updatedAt"])
