"""Demo-state + self-service data contract (v6 — Neon JWT auth, arch §7.4, §7.5)."""


def test_demo_state_roundtrip_and_validation(client, auth_header):
    client.headers.update(auth_header(email="d@example.com"))
    assert client.get("/api/v1/demo-state").json() == {"overrides": []}
    r = client.put("/api/v1/demo-state/TCP%20vs%20UDP", json={"displayTitle": "TCP/UDP", "isPinned": True})
    assert r.status_code == 200, r.text
    assert r.json() == {"demoLabel": "TCP vs UDP", "displayTitle": "TCP/UDP", "isHidden": False, "isPinned": True}
    r = client.put("/api/v1/demo-state/TCP%20vs%20UDP", json={"displayTitle": ""})
    assert r.json()["displayTitle"] is None  # "" clears to registry default
    r = client.put("/api/v1/demo-state/Nope", json={"isHidden": True})
    assert r.status_code == 422
    assert client.get("/api/v1/demo-state").json()["overrides"][0]["demoLabel"] == "TCP vs UDP"


def test_export_shape_and_delete_account_cascade(client, auth_header):
    client.headers.update(auth_header(email="e@example.com"))
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
    # Backend user row is gone. /me upserts a fresh row on the next
    # call (the Neon session is still valid; the frontend is expected
    # to call authClient.signOut() too — spec §I.F4).
    r = client.get("/api/v1/auth/me")
    assert r.status_code == 200
    # ...and the data is back to defaults (no chats, default profile).
    assert r.json()["user"]["onboardingDone"] is False
    assert client.get("/api/v1/chats").json()["pagination"]["total"] == 0
