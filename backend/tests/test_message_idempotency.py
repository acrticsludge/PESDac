"""Message idempotency (Phase 5 T5a locked contract).

`clientMsgKey`: client generates one key per send, sent in
`POST /chats/{code}/messages` body; server stores it with a per-chat
unique constraint; on conflict returns `200` with the existing row
instead of appending a duplicate. Retry after a dropped connection
therefore creates exactly one server row.

Key optional: appends omitting it behave exactly as before (two 201s).

Every messages-list read below passes an explicit `limit=` so a Phase 4
default-page change cannot break these assertions.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

NOT_FOUND = {"error": {"code": "NOT_FOUND", "message": "Chat not found."}}

_KEY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
_KEY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
_KEY_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"


def _create_chat(client: TestClient, subject="CN", title="Idempotency chat"):
    r = client.post("/api/v1/chats", json={"subject": subject, "title": title})
    assert r.status_code == 201, r.text
    return r.json()


def _append(client: TestClient, code: str, key: str | None = None, role="user"):
    body: dict = {"role": role, "content": {"text": "hello"}}
    if key is not None:
        body["clientMsgKey"] = key
    return client.post(f"/api/v1/chats/{code}/messages", json=body)


def _row_count(client: TestClient, code: str) -> int:
    r = client.get(f"/api/v1/chats/{code}/messages", params={"limit": 200, "offset": 0})
    assert r.status_code == 200, r.text
    return r.json()["pagination"]["total"]


def test_msg_retry_same_key_returns_200_existing_row_zero_new_rows(client):
    code = _create_chat(client)["code"]
    first = _append(client, code, key=_KEY_A)
    assert first.status_code == 201, first.text
    first_row = first.json()

    # Retry after a dropped connection (response never arrived): same key
    # → 200 with the SAME row, zero new rows.
    second = _append(client, code, key=_KEY_A)
    assert second.status_code == 200, second.text
    assert second.json() == first_row

    assert _row_count(client, code) == 1


def test_msg_conflict_200_keeps_exact_row_shape(client):
    code = _create_chat(client)["code"]
    first = _append(client, code, key=_KEY_B)
    assert first.status_code == 201, first.text
    second = _append(client, code, key=_KEY_B)
    assert second.status_code == 200, second.text
    assert set(second.json().keys()) == set(first.json().keys())
    assert set(second.json().keys()) == {"id", "seq", "role", "content", "createdAt"}


def test_msg_distinct_keys_create_distinct_rows(client):
    code = _create_chat(client)["code"]
    a = _append(client, code, key=_KEY_A)
    b = _append(client, code, key=_KEY_B)
    assert a.status_code == 201, a.text
    assert b.status_code == 201, b.text
    assert a.json()["id"] != b.json()["id"]
    assert (a.json()["seq"], b.json()["seq"]) == (0, 1)
    assert _row_count(client, code) == 2


def test_msg_append_without_key_unchanged_two_201s(client):
    code = _create_chat(client)["code"]
    a = _append(client, code)
    b = _append(client, code)
    assert a.status_code == 201, a.text
    assert b.status_code == 201, b.text
    assert a.json()["id"] != b.json()["id"]
    assert _row_count(client, code) == 2


def test_msg_key_scoped_per_chat(client):
    first = _create_chat(client, title="Chat one")["code"]
    second = _create_chat(client, title="Chat two")["code"]
    a = _append(client, first, key=_KEY_C)
    b = _append(client, second, key=_KEY_C)
    # Same key in a different chat is a different send — both 201.
    assert a.status_code == 201, a.text
    assert b.status_code == 201, b.text
    assert _row_count(client, first) == 1
    assert _row_count(client, second) == 1


def test_msg_keyed_retry_preserves_seq_and_lean_columns(client):
    code = _create_chat(client)["code"]
    first = _append(client, code, key=_KEY_A)
    assert first.status_code == 201, first.text
    assert first.json()["seq"] == 0
    retry = _append(client, code, key=_KEY_A)
    assert retry.status_code == 200, retry.text
    second = _append(client, code, key=_KEY_B, role="assistant")
    assert second.status_code == 201, second.text
    assert second.json()["seq"] == 1
    row = client.get("/api/v1/chats", params={"limit": 100, "offset": 0}).json()["data"][0]
    assert row["msgCount"] == 2
    assert row["lastSeq"] == 1


def test_msg_key_over_64_chars_rejected(client):
    code = _create_chat(client)["code"]
    r = _append(client, code, key="k" * 65)
    assert r.status_code == 422, r.text
    assert _row_count(client, code) == 0


def test_msg_keyed_append_cross_user_code_404s_without_oracle(client, dbsession):
    from app.models.chats import Chat
    from app.models.users import User

    other = User(auth_user_id="other-user-id", email="other@example.com", display_name="Other")
    dbsession.add(other)
    dbsession.commit()
    dbsession.add(Chat(user_id=other.id, code="zzzz98", subject="CN", title="Other"))
    dbsession.commit()
    r = _append(client, "zzzz98", key=_KEY_A)
    assert r.status_code == 404
    assert r.json() == NOT_FOUND
