"""Startup warmup tests (boot-latency fix).

`warm_jwks_cache` prefetches JWKS so the first authed request skips the
~3s cold fetch. It must never raise: a failed warmup only returns False
and the first request fetches exactly as before (no new failure mode).
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("ENV", "test")
    monkeypatch.setenv("DATABASE_URL", "sqlite://")
    monkeypatch.setenv("FRONTEND_ORIGINS", "http://testserver")
    monkeypatch.setenv("COOKIE_SECURE", "false")
    monkeypatch.setenv("BETTER_AUTH_URL", "http://localhost:4321")
    monkeypatch.setenv("BETTER_AUTH_SECRET", "test-secret-32-characters-long!!")


def test_warmup_populates_cache_on_success():
    from app.auth import betterauth

    betterauth._jwks_cache.clear()

    async def _run():
        with patch.object(
            betterauth,
            "_fetch_jwks",
            AsyncMock(return_value={"k9": {"kid": "k9"}}),
        ):
            return await betterauth.warm_jwks_cache()

    assert asyncio.run(_run()) is True
    assert betterauth._jwks_cache.get("k9") == {"kid": "k9"}
    betterauth._jwks_cache.clear()


def test_warmup_returns_false_without_raising_on_outage():
    from app.auth import betterauth

    betterauth._jwks_cache.clear()

    async def _run():
        with patch.object(
            betterauth, "_fetch_jwks", AsyncMock(side_effect=RuntimeError("boom"))
        ):
            return await betterauth.warm_jwks_cache()

    assert asyncio.run(_run()) is False
    assert betterauth._jwks_cache == {}


def test_warmup_returns_false_on_empty_key_set():
    from app.auth import betterauth

    betterauth._jwks_cache.clear()

    async def _run():
        with patch.object(betterauth, "_fetch_jwks", AsyncMock(return_value={})):
            return await betterauth.warm_jwks_cache()

    assert asyncio.run(_run()) is False
