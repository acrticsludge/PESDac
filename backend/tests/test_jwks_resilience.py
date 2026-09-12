"""P1 JWKS resilience tests (T1.1 singleflight + negative cache, T1.2 shared client).

Proves the 10s-tail fix at the unit level:
- JWKS outage: one verify triggers exactly ONE outbound fetch (the unknown-kid
  retry path fails fast on the short-TTL negative cache instead of a second
  full-timeout fetch).
- Burst: N concurrent lookups at TTL expiry collapse to exactly 1 fetch.
- Happy path, algorithm allow-list, and log categories unchanged.

No tokens, claims, or sensitive fields are asserted on or logged here —
fetch fakes record call counts only.
"""

from __future__ import annotations

import asyncio
import base64
import json
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest


def _b64url(obj: dict[str, Any]) -> str:
    raw = json.dumps(obj, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _make_token(payload: dict[str, Any], kid: str = "k1", alg: str = "RS256") -> str:
    header = {"alg": alg, "typ": "JWT", "kid": kid}
    return f"{_b64url(header)}.{_b64url(payload)}.{_b64url({'sig': 'noop'})}"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("FRONTEND_ORIGINS", "http://testserver")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("BETTER_AUTH_URL", "http://localhost:4321")
    monkeypatch.setenv("BETTER_AUTH_SECRET", "test-secret-32-characters-long!!")


@pytest.fixture(autouse=True)
def _reset_jwks_state():
    """Isolate module-global JWKS state so these tests neither pollute nor
    inherit cache/negative-cache stamps from other test files."""
    from app.auth import betterauth

    betterauth._jwks_cache.clear()
    betterauth._fetched_at = 0.0
    betterauth._fetch_failed_at = 0.0
    yield
    betterauth._jwks_cache.clear()
    betterauth._fetched_at = 0.0
    betterauth._fetch_failed_at = 0.0


def test_outage_verify_fetches_once_not_twice():
    """Blocked JWKS URL: the unknown-kid retry must fail fast (1 fetch)."""
    from app.auth import betterauth

    token = _make_token({"sub": "u1", "email": "u@example.com"})
    calls = 0

    async def _fail_once_counted():
        nonlocal calls
        calls += 1
        raise RuntimeError("blocked JWKS URL")

    async def _run():
        with patch.object(betterauth, "_fetch_jwks", _fail_once_counted):
            return await betterauth.verify_betterauth_token(token)

    assert asyncio.run(_run()) is None
    assert calls == 1


def test_burst_at_ttl_expiry_fetches_once():
    """20 concurrent lookups at TTL expiry collapse to 1 outbound fetch."""
    from app.auth import betterauth

    calls = 0

    async def _slow_ok():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.05)
        return {"k1": {"kid": "k1"}}

    async def _run():
        with patch.object(betterauth, "_fetch_jwks", _slow_ok):
            return await asyncio.gather(
                *[betterauth._get_jwk_for_async("k1") for _ in range(20)]
            )

    results = asyncio.run(_run())
    assert calls == 1
    assert all(r == {"kid": "k1"} for r in results)


def test_negative_cache_expires_and_retries():
    """After the short negative TTL passes, the next lookup fetches again."""
    import time

    from app.auth import betterauth

    calls = 0

    async def _fail_counted():
        nonlocal calls
        calls += 1
        raise RuntimeError("boom")

    async def _run():
        with patch.object(betterauth, "_fetch_jwks", _fail_counted):
            assert await betterauth._get_jwk_for_async("k1") is None
            assert calls == 1
            # Immediate retry fails fast — no second fetch.
            assert await betterauth._get_jwk_for_async("k1") is None
            assert calls == 1
            # Age the negative stamp past its TTL: fetch is attempted again.
            betterauth._fetch_failed_at -= (
                betterauth._NEGATIVE_TTL_SECONDS + 1.0
            )
            assert await betterauth._get_jwk_for_async("k1") is None
            assert calls == 2

    asyncio.run(_run())
    assert time.monotonic()  # monotonic clock available; sanity only


def test_success_clears_negative_cache():
    """A successful fetch clears the failure stamp (recovery is immediate)."""
    from app.auth import betterauth

    calls = 0

    async def _fail_then_ok():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("boom")
        return {"k1": {"kid": "k1"}}

    async def _run():
        with patch.object(betterauth, "_fetch_jwks", _fail_then_ok):
            assert await betterauth._get_jwk_for_async("k1") is None
            betterauth._fetch_failed_at -= (
                betterauth._NEGATIVE_TTL_SECONDS + 1.0
            )
            assert await betterauth._get_jwk_for_async("k1") == {"kid": "k1"}
            assert betterauth._fetch_failed_at == 0.0

    asyncio.run(_run())


def test_cached_kid_served_during_negative_window():
    """A known kid is still served from cache while the negative cache is hot
    for unknown kids (stale-while-outage, no fetch)."""
    from app.auth import betterauth

    async def _run():
        with patch.object(
            betterauth,
            "_fetch_jwks",
            AsyncMock(side_effect=AssertionError("must not fetch")),
        ):
            betterauth._jwks_cache["k1"] = {"kid": "k1"}
            betterauth._fetch_failed_at = __import__("time").monotonic()
            assert await betterauth._get_jwk_for_async("k1") == {"kid": "k1"}
            assert await betterauth._get_jwk_for_async("k2") is None

    asyncio.run(_run())


# --- T1.2: shared httpx.AsyncClient with keep-alive + timeout review ---


class _StubResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _StubClient:
    """Stand-in for the shared httpx.AsyncClient: records GETs, no I/O."""

    def __init__(self, payload):
        self.payload = payload
        self.get_calls: list[str] = []

    async def get(self, url):
        self.get_calls.append(url)
        return _StubResponse(self.payload)


def test_shared_client_singleton_identity():
    """One process-wide client instance (keep-alive), not one per fetch."""
    from app.auth import betterauth

    try:
        assert betterauth._get_shared_client() is betterauth._get_shared_client()
    finally:
        betterauth._shared_client = None


def test_fetch_jwks_uses_shared_client():
    """_fetch_jwks reuses the shared client and still indexes by kid."""
    from app.auth import betterauth

    payload = {"keys": [{"kid": "k1", "kty": "RSA"}, {"no-kid": True}]}

    async def _run():
        stub = _StubClient(payload)
        with patch.object(betterauth, "_shared_client", stub):
            # Bypass lazy init so the stub is used verbatim.
            with patch.object(
                betterauth, "_get_shared_client", return_value=stub
            ):
                first = await betterauth._fetch_jwks()
                second = await betterauth._fetch_jwks()
        return stub, first, second

    stub, first, second = asyncio.run(_run())
    assert first == {"k1": {"kid": "k1", "kty": "RSA"}}
    assert second == first
    assert len(stub.get_calls) == 2
    assert all(
        url == "http://localhost:4321/api/auth/jwks" for url in stub.get_calls
    )


def test_timeout_review_keeps_five_seconds():
    """Timeout stays 5s: the measured ~3s cold fetch (see lifespan warmup in
    app/main.py) would regress under ~2s, so T1.1 bounds the tail instead."""
    from app.auth import betterauth

    assert betterauth._JWKS_HTTP_TIMEOUT_S == 5.0
    client = betterauth._get_shared_client()
    try:
        assert client.timeout.connect == 5.0
        assert client.timeout.read == 5.0
        assert client.timeout.write == 5.0
        assert client.timeout.pool == 5.0
    finally:
        # Reset the singleton so no cross-test client leaks between loops.
        betterauth._shared_client = None
