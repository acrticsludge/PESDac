"""Profiles contract (v6 — Neon JWT auth): blank-default auto-create, merge PATCH, enums (arch §7.2)."""


def test_profiles_unauthenticated(client):
    assert client.get("/api/v1/profiles/me").status_code == 401


def test_profiles_first_read_is_blank_defaults(client, auth_header):
    # v6: signup carries a displayName from Neon, so the profile row is
    # auto-populated with that name. Other prefs still default to blanks.
    client.headers.update(auth_header(email="p@example.com", name="PES User"))
    r = client.get("/api/v1/profiles/me")
    assert r.status_code == 200
    body = r.json()
    assert body["displayName"] == "PES User"
    assert body["email"] == "p@example.com"
    assert body["weeklyGoal"] == "5 days"
    assert body["difficulty"] == "medium"
    assert body["depth"] == "auto"
    assert body["retention"] == "forever"
    assert body["subjects"] == []
    assert body["proactiveQuiz"] is True
    assert body["onboardingDone"] is False


def test_profiles_patch_merges_and_returns_full_row(client, auth_header):
    client.headers.update(auth_header(email="p@example.com"))
    r = client.patch("/api/v1/profiles/me", json={"difficulty": "hard", "proactiveQuiz": False})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["difficulty"] == "hard"
    assert body["proactiveQuiz"] is False
    assert body["weeklyGoal"] == "5 days"  # untouched defaults survive
    r = client.get("/api/v1/profiles/me")
    assert r.json()["difficulty"] == "hard"


def test_profiles_rejects_bad_enum_unknown_key_bad_subject(client, auth_header):
    client.headers.update(auth_header(email="p@example.com"))
    assert client.patch("/api/v1/profiles/me", json={"difficulty": "nightmare"}).status_code == 422
    assert client.patch("/api/v1/profiles/me", json={"nope": 1}).status_code == 422
    assert client.patch("/api/v1/profiles/me", json={"subjects": ["CN", "XX"]}).status_code == 422
    assert client.patch("/api/v1/profiles/me", json={"semester": "9"}).status_code == 422
    # Campus enum (v6): unknown campus is rejected.
    assert client.patch("/api/v1/profiles/me", json={"campus": "MIT"}).status_code == 422
    r = client.patch("/api/v1/profiles/me", json={"subjects": ["CN", "DSA"], "semester": "4", "branch": "CSE", "campus": "RR"})
    assert r.status_code == 200
    assert r.json()["subjects"] == ["CN", "DSA"]
    assert r.json()["campus"] == "RR"


def test_profiles_accepts_cse_core_and_aiml_branches(client, auth_header):
    client.headers.update(auth_header(email="b@example.com"))
    for branch in ("CSE(Core)", "CSE(AI&ML)"):
        r = client.patch("/api/v1/profiles/me", json={"branch": branch})
        assert r.status_code == 200
        assert r.json()["branch"] == branch
    assert client.patch("/api/v1/profiles/me", json={"branch": "CSE(Bio)"}).status_code == 422
