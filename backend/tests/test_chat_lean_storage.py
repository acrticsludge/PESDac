"""Chat-history lean storage (Stream A): preview/msg_count/last_seq txn
wiring, truncate recompute, retention-purge boundary, metadata/index shape."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.db import Base
from app.routers.chats import PREVIEW_MAX_CHARS, purge_expired_chats


def _create(client: TestClient, subject="CN", title="OSI model"):
    r = client.post("/api/v1/chats", json={"subject": subject, "title": title})
    assert r.status_code == 201, r.text
    return r.json()


def _append(client: TestClient, code: str, role="user", content=None):
    return client.post(
        f"/api/v1/chats/{code}/messages",
        json={"role": role, "content": {"text": "hello"} if content is None else content},
    )


def test_chat_out_carries_lean_defaults_on_create():
    tables = Base.metadata.tables
    assert {"preview", "msg_count", "last_seq"} <= set(tables["chats"].columns.keys())
    names = {i.name for i in tables["chats"].indexes}
    assert "ix_chats_user_updated" in names


def test_list_rows_carry_preview_counts_without_bodies(client):
    chat = _create(client)
    row = client.get("/api/v1/chats").json()["data"][0]
    assert (row["preview"], row["msgCount"], row["lastSeq"]) == ("", 0, 0)
    assert "content" not in row
    assert chat["preview"] == "" and chat["msgCount"] == 0 and chat["lastSeq"] == 0


def test_append_updates_counts_and_preview_in_same_txn(client):
    code = _create(client)["code"]
    _append(client, code, role="user", content={"from": "user", "text": "SubnetsID"})
    _append(
        client,
        code,
        role="assistant",
        content={
            "from": "assistant",
            "bubbles": [{"type": "text", "text": "A subnet splits the host space"}],
            "footer": "PESDac · CN",
            "time": "2026-09-10T00:00:00Z",
            "toolCallsExpanded": True,
        },
    )
    row = client.get("/api/v1/chats").json()["data"][0]
    assert (row["msgCount"], row["lastSeq"]) == (2, 1)
    # Latest turn wins; render-only keys never leak into the snippet.
    assert row["preview"] == "A subnet splits the host space"
    assert "PESDac" not in row["preview"] and "2026" not in row["preview"]


def test_preview_truncates_to_280_chars(client):
    code = _create(client)["code"]
    _append(client, code, content={"from": "user", "text": "w" * 1000})
    row = client.get("/api/v1/chats").json()["data"][0]
    assert len(row["preview"]) <= PREVIEW_MAX_CHARS == 280


def test_truncate_recomputes_counts_preview_and_touches_updated(client, dbsession):
    from app.models.chats import Chat

    before = _create(client)
    code = before["code"]
    _append(client, code, content={"from": "user", "text": "keep me"})
    _append(client, code, content={"from": "user", "text": "drop me"})
    assert client.delete(f"/api/v1/chats/{code}/messages", params={"from_seq": 1}).status_code == 200
    row = client.get("/api/v1/chats").json()["data"][0]
    assert (row["msgCount"], row["lastSeq"], row["preview"]) == (1, 0, "keep me")
    assert datetime.fromisoformat(row["updatedAt"]) >= datetime.fromisoformat(before["updatedAt"])
    # Full clear zeroes the window.
    assert client.delete(f"/api/v1/chats/{code}/messages", params={"from_seq": 0}).status_code == 200
    row = client.get("/api/v1/chats").json()["data"][0]
    assert (row["msgCount"], row["lastSeq"], row["preview"]) == (0, 0, "")
    assert dbsession.query(Chat).filter(Chat.code == code).one().msg_count == 0


def test_retention_purge_boundary_and_cascade(client, dbsession):
    from app.models.chats import Chat, Message

    assert client.patch("/api/v1/profiles/me", json={"retention": "30 days"}).status_code == 200
    stale = _create(client, title="stale chat")["code"]
    fresh = _create(client, title="fresh chat")["code"]
    _append(client, stale, content={"from": "user", "text": "old turn"})
    old = datetime.now(timezone.utc) - timedelta(days=60)
    dbsession.query(Chat).filter(Chat.code == stale).update({"updated_at": old})
    dbsession.commit()

    purged = purge_expired_chats(dbsession)
    assert purged == {"30 days": 1}
    assert dbsession.query(Chat).filter(Chat.code == stale).count() == 0
    assert dbsession.query(Message).count() == 0  # cascade, not orphans
    assert dbsession.query(Chat).filter(Chat.code == fresh).count() == 1


def test_retention_forever_keeps_stale_chats(client, dbsession):
    from app.models.chats import Chat

    assert client.patch("/api/v1/profiles/me", json={"retention": "forever"}).status_code == 200
    code = _create(client, title="ancient")["code"]
    old = datetime.now(timezone.utc) - timedelta(days=400)
    dbsession.query(Chat).filter(Chat.code == code).update({"updated_at": old})
    dbsession.commit()
    assert purge_expired_chats(dbsession) == {}
    assert dbsession.query(Chat).filter(Chat.code == code).count() == 1
