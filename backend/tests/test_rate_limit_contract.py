"""Rate-limit contract: mutation routes 429 with envelope + Retry-After.

Limits are generous by design (abuse protection, not quota): 60/min for
routine mutations, 10/5min for destructive ones. Reads are unlimited here.
"""

from __future__ import annotations

from fastapi import Request

from app import rate_limit


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


def _request(client_host: str, forwarded_for: str | None = None) -> Request:
    headers = []
    if forwarded_for is not None:
        headers.append((b"x-forwarded-for", forwarded_for.encode()))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/chats",
            "headers": headers,
            "client": (client_host, 5000),
        }
    )


def test_forwarded_header_ignored_without_trusted_proxy(monkeypatch):
    # §12 item 3: untrusted X-Forwarded-For is spoofable — without
    # TRUSTED_PROXY_HOSTS the limiter uses the direct connection IP.
    monkeypatch.setattr(rate_limit, "_trusted_proxy_hosts", set())
    req = _request("10.0.0.1", "9.9.9.9")
    assert rate_limit._client_ip(req) == "10.0.0.1"


def test_forwarded_header_honored_through_trusted_proxy(monkeypatch):
    # Direct connection arrives via the configured proxy: first XFF
    # entry is the client.
    monkeypatch.setattr(rate_limit, "_trusted_proxy_hosts", {"10.0.0.1"})
    req = _request("10.0.0.1", "9.9.9.9, 10.0.0.2")
    assert rate_limit._client_ip(req) == "9.9.9.9"


def test_spoofed_forwarded_from_direct_connection_dropped(monkeypatch):
    # Attacker connects directly with a forged XFF: not trusted, dropped.
    monkeypatch.setattr(rate_limit, "_trusted_proxy_hosts", {"10.0.0.9"})
    req = _request("6.6.6.6", "1.1.1.1")
    assert rate_limit._client_ip(req) == "6.6.6.6"


def test_window_boundary_releases_the_bucket(client):
    # §12 item 3: frozen clock — 60 hits at t, 61st refused, then the
    # window slides past and the same caller is allowed again.
    rate_limit.__set_now_for_testing(1000.0)
    try:
        for _ in range(60):
            r = client.patch("/api/v1/profiles/me", json={"difficulty": "hard"})
            assert r.status_code == 200, r.text
        r = client.patch("/api/v1/profiles/me", json={"difficulty": "hard"})
        assert r.status_code == 429, r.text
        assert int(r.headers["Retry-After"]) > 0
        rate_limit.__set_now_for_testing(1000.0 + 60.0 + 1.0)
        r = client.patch("/api/v1/profiles/me", json={"difficulty": "hard"})
        assert r.status_code == 200, r.text
    finally:
        rate_limit.__set_now_for_testing(None)
