"""Export proof (audit §9 item 4): scoped, bounded, versioned, secret-free.

- Scoped: only the caller's rows (cross-user coverage lives in
  test_cross_user_isolation.py; here the positive shape).
- Bounded: 205 stored chats export exactly EXPORT_MAX_ROWS.
- Versioned: `version: 1` + parseable `exportedAt`, exact top-level keys.
- Secret-free: a recursive key scan of the whole payload rejects
  credential/token/key-shaped fields, and per-section key sets pin
  that ids, adopt keys, and identity linkage never serialize.
"""

from __future__ import annotations

import json
from datetime import datetime

from app.models.chats import Chat, DemoState
from app.models.llm import LlmCredential
from app.models.profiles import Profile
from app.models.users import User
from app.routers.users import EXPORT_MAX_ROWS

FORBIDDEN_SUBSTRINGS = (
    "password",
    "token",
    "secret",
    "adopt",
    "auth_user",
    "private",
)


def _walk_keys(node, out: set[str]):
    if isinstance(node, dict):
        for k, v in node.items():
            out.add(str(k))
            _walk_keys(v, out)
    elif isinstance(node, list):
        for v in node:
            _walk_keys(v, out)


def test_export_exact_shape_and_version(client):
    client.post("/api/v1/chats", json={"subject": "DSA", "title": "Trees"})
    client.patch("/api/v1/profiles/me", json={"difficulty": "hard"})
    client.put("/api/v1/demo-state/TCP%20vs%20UDP", json={"isPinned": True})
    body = client.get("/api/v1/users/me/export").json()
    assert set(body.keys()) == {"profile", "chats", "demoState", "exportedAt", "version"}
    assert body["version"] == 1
    datetime.fromisoformat(body["exportedAt"])  # parseable timestamp
    assert body["profile"]["difficulty"] == "hard"
    assert set(body["chats"][0].keys()) == {
        "code", "subject", "title", "isPinned", "isArchived",
        "createdAt", "updatedAt", "preview", "msgCount", "lastSeq",
    }
    assert set(body["demoState"][0].keys()) == {
        "demoLabel", "displayTitle", "isHidden", "isPinned",
    }


def test_export_is_secret_free_even_with_credentials_stored(client, dbsession):
    me = client.get("/api/v1/auth/me").json()["user"]
    user = dbsession.query(User).filter(User.auth_user_id == "test-auth-user-id").one()
    assert str(user.id) == me["id"]
    dbsession.add(
        LlmCredential(user_id=user.id, provider="openrouter", key_encrypted="gibberish-secret")
    )
    chat = Chat(user_id=user.id, code="SECR01", subject="CN", title="Secrets nearby")
    dbsession.add(chat)
    dbsession.add(DemoState(user_id=user.id, demo_label="OSI Model"))
    dbsession.commit()

    body = client.get("/api/v1/users/me/export").json()
    keys: set[str] = set()
    _walk_keys(body, keys)
    hits = {k for k in keys if any(s in k.lower() for s in FORBIDDEN_SUBSTRINGS)}
    assert not hits, hits
    dump = json.dumps(body)
    assert "gibberish-secret" not in dump
    assert "test-auth-user-id" not in dump
    # The profile carries no identity-linkage column.
    assert "auth_user_id" not in body["profile"]


def test_export_bounded_at_export_max_rows(client, dbsession):
    user = dbsession.query(User).filter(User.auth_user_id == "test-auth-user-id").first()
    if user is None:
        client.get("/api/v1/auth/me")
        user = dbsession.query(User).filter(User.auth_user_id == "test-auth-user-id").first()
    assert user is not None
    if dbsession.get(Profile, user.id) is None:
        dbsession.add(Profile(user_id=user.id))
    for i in range(EXPORT_MAX_ROWS + 5):
        dbsession.add(
            Chat(user_id=user.id, code=f"C{i:05d}", subject="CN", title=f"bulk {i}")
        )
    dbsession.commit()
    body = client.get("/api/v1/users/me/export").json()
    assert len(body["chats"]) == EXPORT_MAX_ROWS
