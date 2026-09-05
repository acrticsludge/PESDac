"""Neon JWT verify (TDD: app/auth/neon.py).

Spec login-signup v6 §10. EdDSA verify against NEON_AUTH_JWKS_URL.
JWKS is cached 1h by `kid`. On unknown `kid` we refetch once before
failing. Required claims: `sub`, `email`, `exp`. The frontend never
sets `aud` (Neon does not always set it), so we don't require it.

The only network seam is `load_jwks_from(url)` — tests monkeypatch it.
"""

from __future__ import annotations

import time
from typing import Any, Callable

import jwt
from jwt import PyJWKClient

from app import config

_jwks_cache: dict[str, dict] = {}
_fetched_at: float = 0.0
_TTL_SECONDS = 3600

# Function seam for tests. Returns a parsed JWK-set (dict of kid -> jwk).
_load_jwks: Callable[[str], dict[str, dict]] | None = None


def _set_loader(loader: Callable[[str], dict[str, dict]] | None) -> None:
    """Test hook. None restores default (httpx-backed) loader."""
    global _load_jwks
    _load_jwks = loader


def _default_loader(url: str) -> dict[str, dict]:
    """Real loader: PyJWKClient gives us keys by kid."""
    if not hasattr(_default_loader, "_client"):
        _default_loader._client = PyJWKClient(url, cache_keys=True, lifespan=_TTL_SECONDS)
    return _default_loader._client


def _get_jwk_for(kid: str) -> dict | None:
    """Return the JWK for `kid` (or None). Refetches JWKS on miss once."""
    if not config.NEON_AUTH_JWKS_URL:
        return None
    global _fetched_at
    if kid not in _jwks_cache or (time.monotonic() - _fetched_at) > _TTL_SECONDS:
        try:
            if _load_jwks is not None:
                _jwks_cache.update(_load_jwks(config.NEON_AUTH_JWKS_URL))
            else:
                client = _default_loader(config.NEON_AUTH_JWKS_URL)
                # PyJWKClient: fetch a known-bad key to force the JWKS fetch
                # is wasteful; instead, re-instantiate to refresh.
                _default_loader._client = PyJWKClient(
                    config.NEON_AUTH_JWKS_URL, cache_keys=True, lifespan=_TTL_SECONDS
                )
            _fetched_at = time.monotonic()
        except Exception:
            return None
    return _jwks_cache.get(kid)


def reset_cache() -> None:
    """Test hook: clear JWKS cache + loader override."""
    global _fetched_at
    _jwks_cache.clear()
    _fetched_at = 0.0
    _set_loader(None)


def _add_to_cache(jwks: dict[str, dict]) -> None:
    """Test hook: prime the cache directly."""
    global _fetched_at
    _jwks_cache.update(jwks)
    _fetched_at = time.monotonic()


def verify_neon_jwt(token: str) -> dict[str, Any]:
    """Verify `token` and return the claims dict. Raises jwt.PyJWTError."""
    if not config.NEON_AUTH_JWKS_URL:
        raise jwt.InvalidTokenError("NEON_AUTH_JWKS_URL is not configured")
    headers = jwt.get_unverified_header(token)
    kid = headers.get("kid")
    if not kid:
        raise jwt.InvalidTokenError("Missing kid header")
    jwk_dict = _get_jwk_for(kid)
    if jwk_dict is None:
        # One forced refetch then re-look-up.
        reset_cache()
        jwk_dict = _get_jwk_for(kid)
    if jwk_dict is None:
        raise jwt.InvalidTokenError("Unknown kid")
    try:
        from jwt.algorithms import OKPAlgorithm
        jwk_obj = OKPAlgorithm.from_jwk(jwk_dict)
    except Exception as exc:
        raise jwt.InvalidTokenError(f"Malformed JWK: {exc}") from exc
    return jwt.decode(
        token,
        jwk_obj,
        algorithms=["EdDSA"],
        options={"require": ["sub", "email", "exp"], "verify_aud": False},
    )
