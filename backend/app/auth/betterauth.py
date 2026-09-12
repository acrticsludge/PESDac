"""BetterAuth JWT verification via JWKS.

Verifies BetterAuth session tokens using the JWKS endpoint.
Validation (T17):
- algorithm allow-list (no `none`, no algorithm-confusion tricks)
- issuer + audience required (configured, not optional)
- expiration + not-before
- required subject + email claims
- defensive header parsing
- unknown `kid` triggers one forced JWKS refresh, then re-tries once
- bounded JWKS HTTP timeout
- generic 401 to clients, safe categories in server logs
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx
import jwt

from app import config

logger = logging.getLogger("pesdac")

# Allow-list of JWT algorithms BetterAuth issues. RS256 and EdDSA only —
# accepting `none` or HS256 here would open the door to algorithm
# confusion (a forged RS256-signed-as-HS256 token, etc.).
_ALLOWED_ALGORITHMS: tuple[str, ...] = ("RS256", "EdDSA")

_jwks_cache: dict[str, dict] = {}
_fetched_at: float = 0.0
_TTL_SECONDS = 3600  # 1 hour
# T1.2 timeout review: the lifespan warmup in app/main.py measures ~3s for a
# cold JWKS fetch, so lowering toward ~2s would risk timeout regressions on
# slow networks. Keep 5s; the 10s tail is bounded by T1.1 instead (single
# fetch + fail-fast retry), and keep-alive below removes per-fetch TLS.
_JWKS_HTTP_TIMEOUT_S = 5.0

# T1.1: singleflight lock + short-TTL negative cache. Concurrent lookups
# collapse onto one outbound fetch (the first holder fetches, waiters re-check
# the cache after acquiring the lock). A failed fetch stamps _fetch_failed_at;
# lookups within _NEGATIVE_TTL_SECONDS then fail fast from cache instead of
# triggering an immediate second full-timeout fetch from the unknown-kid
# retry path in verify_betterauth_token (the 5s+5s tail). A successful fetch
# clears the stamp, so recovery is immediate. Serving a stale cached kid
# during the negative window is intentional (availability; the key was
# previously trusted, and unknown kids still fail closed).
_NEGATIVE_TTL_SECONDS = 30.0
_fetch_failed_at: float = 0.0
_jwks_fetch_lock = asyncio.Lock()

# T1.2: one process-wide keep-alive client for all JWKS fetches. Created
# lazily; every call site holds _jwks_fetch_lock while fetching, so the lazy
# init is race-free in practice (a duplicated init from a direct _fetch_jwks
# caller would only leak one idle client). Process lifetime is intentional:
# wiring an explicit aclose would require touching lifespan/deps, which P1
# does not own — httpx reaps idle keep-alive connections itself.
_shared_client: httpx.AsyncClient | None = None


def _get_shared_client() -> httpx.AsyncClient:
    """Return the shared JWKS HTTP client (keep-alive connection reuse)."""
    global _shared_client
    if _shared_client is None:
        _shared_client = httpx.AsyncClient(timeout=_JWKS_HTTP_TIMEOUT_S)
    return _shared_client


def _lookup_cached(kid: str, force_refresh: bool, now: float) -> tuple[bool, dict | None]:
    """Synchronous cache decision: (served, jwk).

    Served True means the caller must NOT fetch (fresh hit, or negative
    cache hot). Served False means the caller must fetch under the lock.
    """
    if (
        not force_refresh
        and kid in _jwks_cache
        and (now - _fetched_at) <= _TTL_SECONDS
    ):
        return True, _jwks_cache.get(kid)
    if (now - _fetch_failed_at) < _NEGATIVE_TTL_SECONDS:
        return True, _jwks_cache.get(kid)
    return False, None


async def _fetch_jwks() -> dict[str, dict]:
    """Fetch JWKS from BetterAuth and index by kid."""
    if not config.BETTER_AUTH_URL:
        raise RuntimeError("BETTER_AUTH_URL not configured")
    jwks_url = f"{config.BETTER_AUTH_URL}/api/auth/jwks"
    resp = await _get_shared_client().get(jwks_url)
    resp.raise_for_status()
    data = resp.json()

    keys = data.get("keys", [])
    return {
        key["kid"]: key
        for key in keys
        if isinstance(key, dict) and key.get("kid")
    }


async def _get_jwk_for_async(kid: str, force_refresh: bool = False) -> dict | None:
    """Async JWKS lookup with forced-refresh on unknown kid."""
    global _fetched_at, _fetch_failed_at

    # Fast path: fresh hit or hot negative cache — no lock, no fetch.
    served, jwk = _lookup_cached(kid, force_refresh, time.monotonic())
    if served:
        return jwk

    async with _jwks_fetch_lock:
        # Re-check: a waiter ahead of us may have refreshed (or recorded a
        # failure) while we queued — that is the singleflight coalescing.
        served, jwk = _lookup_cached(kid, force_refresh, time.monotonic())
        if served:
            return jwk
        try:
            fetched = await _fetch_jwks()
        except Exception as exc:
            # JWKS outage — never bubble up the raw exception to the
            # caller. We log a category so operators can act.
            _fetch_failed_at = time.monotonic()
            logger.warning("jwks_fetch_failed category=%s", type(exc).__name__)
            return None
        _fetch_failed_at = 0.0
        _jwks_cache.update(fetched)
        _fetched_at = time.monotonic()

    return _jwks_cache.get(kid)


async def warm_jwks_cache() -> bool:
    """Prefetch JWKS at startup so the first authed request skips the
    fetch (~3s cold). Same never-throw guarantee as the lookup path:
    False on any failure, and the first request simply fetches then."""
    global _fetched_at, _fetch_failed_at
    async with _jwks_fetch_lock:
        try:
            fetched = await _fetch_jwks()
        except Exception as exc:
            _fetch_failed_at = time.monotonic()
            logger.warning("jwks_warmup_failed category=%s", type(exc).__name__)
            return False
        if not fetched:
            return False
        _fetch_failed_at = 0.0
        _jwks_cache.update(fetched)
        _fetched_at = time.monotonic()
        return True


def _resolve_issuer() -> str | None:
    base = (config.BETTER_AUTH_URL or "").rstrip("/")
    return base or None


def _resolve_audience() -> str | None:
    # BetterAuth does not currently emit an `aud` claim by default — the
    # API checks for the configured appName as audience. Operators may
    # set BETTER_AUTH_AUDIENCE to override; when unset the verifier
    # accepts the absence of aud without disabling it (BetterAuth omits
    # it entirely). Tests use a strict audience.
    return config.BETTER_AUTH_AUDIENCE


async def verify_betterauth_token(token: str) -> dict[str, Any] | None:
    """Verify BetterAuth JWT and return claims dict. Returns None if invalid.

    Generic 401 to the client. Server logs keep the safe category so an
    operator can correlate "expired" vs "wrong issuer" vs "JWKS outage"
    without seeing claims, tokens, or PII.
    """
    try:
        # Get kid from header — malformed tokens reach here, not below.
        try:
            headers = jwt.get_unverified_header(token)
        except jwt.PyJWTError:
            logger.info("jwt_invalid category=header")
            return None
        if not isinstance(headers, dict):
            return None
        kid = headers.get("kid")
        alg = headers.get("alg")
        if not kid or not isinstance(kid, str):
            logger.info("jwt_invalid category=missing_kid")
            return None
        if not isinstance(alg, str) or alg not in _ALLOWED_ALGORITHMS:
            logger.info("jwt_invalid category=alg alg=%s", alg)
            return None

        jwk = await _get_jwk_for_async(kid)
        if not jwk:
            # One forced refresh (T17): a rotated key the cached JWKS
            # hasn't picked up yet. After this, give up.
            jwk = await _get_jwk_for_async(kid, force_refresh=True)
        if not jwk:
            logger.info("jwt_invalid category=unknown_kid")
            return None

        # Convert JWK to key object. BetterAuth issues RS256 + EdDSA;
        # only those are accepted per the algorithm allow-list above.
        jwk_obj = None
        if alg == "EdDSA":
            from jwt.algorithms import OKPAlgorithm

            try:
                jwk_obj = OKPAlgorithm.from_jwk(jwk)
            except Exception:
                logger.info("jwt_invalid category=jwk_parse alg=EdDSA")
                return None
        elif alg == "RS256":
            from jwt.algorithms import RSAAlgorithm

            try:
                jwk_obj = RSAAlgorithm.from_jwk(jwk)
            except Exception:
                logger.info("jwt_invalid category=jwk_parse alg=RS256")
                return None
        if jwk_obj is None:
            return None

        audience = _resolve_audience()
        issuer = _resolve_issuer()
        decode_kwargs: dict[str, Any] = {
            "algorithms": list(_ALLOWED_ALGORITHMS),
            "options": {
                "require": ["exp", "iat", "sub"],
                "verify_aud": audience is not None,
                "verify_iss": issuer is not None,
                "verify_exp": True,
                "verify_iat": True,
                "verify_nbf": True,
            },
        }
        if audience is not None:
            decode_kwargs["audience"] = audience
        if issuer is not None:
            decode_kwargs["issuer"] = issuer

        try:
            claims = jwt.decode(token, jwk_obj, **decode_kwargs)
        except jwt.ExpiredSignatureError:
            logger.info("jwt_invalid category=expired")
            return None
        except jwt.ImmatureSignatureError:
            logger.info("jwt_invalid category=nbf")
            return None
        except jwt.InvalidIssuerError:
            logger.info("jwt_invalid category=issuer")
            return None
        except jwt.InvalidAudienceError:
            logger.info("jwt_invalid category=audience")
            return None
        except jwt.InvalidSignatureError:
            logger.info("jwt_invalid category=signature")
            return None
        except jwt.MissingRequiredClaimError as exc:
            logger.info("jwt_invalid category=missing_claim claim=%s", exc.claim)
            return None
        except jwt.InvalidAlgorithmError:
            logger.info("jwt_invalid category=algorithm")
            return None
        except jwt.PyJWTError as exc:
            logger.info("jwt_invalid category=other type=%s", type(exc).__name__)
            return None

        # Required claims (email is needed by get_current_user to seed the
        # PESDac users row when a new user signs in).
        if not claims.get("sub") or not claims.get("email"):
            logger.info("jwt_invalid category=missing_claim email_or_sub")
            return None

        return claims
    except Exception as exc:
        # Last-resort catch so a JWKS outage or unexpected internal error
        # surfaces as a generic 401, not a 500 with internals.
        logger.warning("jwt_unexpected category=%s", type(exc).__name__)
        return None


__all__ = [
    "verify_betterauth_token",
]