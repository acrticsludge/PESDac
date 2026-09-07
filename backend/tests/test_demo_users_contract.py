"""Demo-state + self-service data contract (BetterAuth migration, arch §7.4, §7.5)."""

from __future__ import annotations

import uuid

from app.models.chats import Chat, DemoState
from app.models.profiles import Profile


def test_demo_state_roundtrip_and_validation(client):
    assert client.get("/api/v1/demo-state").json() == {"overrides": []}
    r = client.put("/api/v1/demo-state/TCP%20vs%20UDP", json={"displayTitle": "TCP/UDP", "isPinned": True})
    assert r.status_code == 200, r.text
    assert r.json() == {"demoLabel": "TCP vs UDP", "displayTitle": "TCP/UDP", "isHidden": False, "isPinned": True}
    r = client.put("/api/v1/demo-state/TCP%20vs%20UDP", json={"displayTitle": ""})
    assert r.json()["displayTitle"] is None  # "" clears to registry default
    r = client.put("/api/v1/demo-state/Nope", json={"isHidden": True})
    assert r.status_code == 422
    assert client.get("/api/v1/demo-state").json()["overrides"][0]["demoLabel"] == "TCP vs UDP"


def test_export_shape_and_delete_account_cascade(client, dbsession):
    client.post("/api/v1/chats", json={"subject": "DSA", "title": "Trees"})
    client.patch("/api/v1/profiles/me", json={"difficulty": "hard"})
    client.put("/api/v1/demo-state/TCP%20vs%20UDP", json={"isPinned": True})
    r = client.get("/api/v1/users/me/export")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == 1
    assert body["profile"]["difficulty"] == "hard"
    assert len(body["chats"]) == 1
    assert "exportedAt" in body
    old_id = uuid.UUID(client.get("/api/v1/auth/me").json()["user"]["id"])
    r = client.delete("/api/v1/users/me")
    assert r.status_code == 202
    # Orphan check against the OLD row id: /me recreates the dev user on
    # the next call, so re-querying through the API can never prove the
    # cascade — assert directly on the tables.
    assert dbsession.get(Profile, old_id) is None
    assert dbsession.query(Chat).filter(Chat.user_id == old_id).count() == 0
    assert dbsession.query(DemoState).filter(DemoState.user_id == old_id).count() == 0
    # Backend user row is gone. /me recreates it on the next call.
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 200
    # ...and the data is back to defaults (no chats, default profile).
    assert r.json()["user"]["onboardingDone"] is False
    assert client.get("/api/v1/chats").json()["pagination"]["total"] == 0
