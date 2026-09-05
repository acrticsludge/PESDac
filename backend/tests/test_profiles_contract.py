"""Profiles contract: blank-default auto-create, merge PATCH, enums (arch §7.2)."""

from __future__ import annotations

from tests.conftest import auth_client


def test_profiles_unauthenticated(client):
    assert client.get("/api/v1/profiles/me").status_code == 401


def test_profiles_first_read_is_blank_defaults(client):
    auth_client(client)
    r = client.get("/api/v1/profiles/me")
    assert r.status_code == 200
    body = r.json()
    assert body["displayName"] == ""
    assert body["weeklyGoal"] == "5 days"
    assert body["difficulty"] == "medium"
    assert body["depth"] == "auto"
    assert body["retention"] == "forever"
    assert body["subjects"] == []
    assert body["proactiveQuiz"] is True


def test_profiles_patch_merges_and_returns_full_row(client):
    auth_client(client)
    r = client.patch("/api/v1/profiles/me", json={"difficulty": "hard", "proactiveQuiz": False})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["difficulty"] == "hard"
    assert body["proactiveQuiz"] is False
    assert body["weeklyGoal"] == "5 days"  # untouched defaults survive
    r = client.get("/api/v1/profiles/me")
    assert r.json()["difficulty"] == "hard"


def test_profiles_rejects_bad_enum_unknown_key_bad_subject(client):
    auth_client(client)
    assert client.patch("/api/v1/profiles/me", json={"difficulty": "nightmare"}).status_code == 422
    assert client.patch("/api/v1/profiles/me", json={"nope": 1}).status_code == 422
    assert client.patch("/api/v1/profiles/me", json={"subjects": ["CN", "XX"]}).status_code == 422
    assert client.patch("/api/v1/profiles/me", json={"semester": "9"}).status_code == 422
    r = client.patch("/api/v1/profiles/me", json={"subjects": ["CN", "DSA"], "semester": "4", "branch": "CSE"})
    assert r.status_code == 200
    assert r.json()["subjects"] == ["CN", "DSA"]
