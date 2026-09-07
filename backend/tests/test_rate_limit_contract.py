"""Rate-limit contract: mutation routes 429 with envelope + Retry-After.

Limits are generous by design (abuse protection, not quota): 60/min for
routine mutations, 10/5min for destructive ones. Reads are unlimited here.
"""

from __future__ import annotations


def test_profiles_patch_rate_limited_after_60_per_minute(client):
    for _ in range(60):
        r = client.patch("/api/v1/profiles/me", json={"difficulty": "hard"})
        assert r.status_code == 200, r.text
    r = client.patch("/api/v1/profiles/me", json={"difficulty": "hard"})
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "RATE_LIMITED"
    assert "Retry-After" in r.headers


def test_delete_account_rate_limited_after_10_per_5min(client):
    # Destructive route: 10 per 5 minutes. Each 204 deletes the user row,
    # which /me recreates on the next call in dev-user mode.
    # T22: idempotent (204 whether the row existed or not).
    for _ in range(10):
        r = client.delete("/api/v1/users/me")
        assert r.status_code == 204, r.text
    r = client.delete("/api/v1/users/me")
    assert r.status_code == 429
    assert r.json()["error"]["code"] == "RATE_LIMITED"


def test_rate_limit_buckets_reset_between_tests(client):
    # The per-test client fixture resets buckets: a fresh test starts clean
    # even though the previous test exhausted its bucket.
    r = client.patch("/api/v1/profiles/me", json={"difficulty": "easy"})
    assert r.status_code == 200, r.text
