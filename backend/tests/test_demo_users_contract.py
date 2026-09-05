"""Demo-state + self-service data contract (arch §7.4, §7.5)."""

from __future__ import annotations

from tests.conftest import auth_client


def test_demo_state_roundtrip_and_validation(client):
    auth_client(client)
    assert client.get("/api/v1/demo-state").json() == {"overrides": []}
    r = client.put("/api/v1/demo-state/TCP%20vs%20UDP", json={"displayTitle": "TCP/UDP", "isPinned": True})
    assert r.status_code == 200, r.text
    assert r.json() == {"demoLabel": "TCP vs UDP", "displayTitle": "TCP/UDP", "isHidden": False, "isPinned": True}
    r = client.put("/api/v1/demo-state/TCP%20vs%20UDP", json={"displayTitle": ""})
    assert r.json()["displayTitle"] is None  # "" clears to registry default
    r = client.put("/api/v1/demo-state/Nope", json={"isHidden": True})
    assert r.status_code == 422
    assert client.get("/api/v1/demo-state").json()["overrides"][0]["demoLabel"] == "TCP vs UDP"


def test_export_shape_and_delete_account_cascade(client):
    auth_client(client)
    client.post("/api/v1/chats", json={"subject": "DSA", "title": "Trees"})
    client.patch("/api/v1/profiles/me", json={"difficulty": "hard"})
    r = client.get("/api/v1/users/me/export")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == 1
    assert body["profile"]["difficulty"] == "hard"
    assert len(body["chats"]) == 1
    assert "exportedAt" in body
    r = client.delete("/api/v1/users/me")
    assert r.status_code == 202
    assert client.get("/api/v1/auth/me").status_code == 401
