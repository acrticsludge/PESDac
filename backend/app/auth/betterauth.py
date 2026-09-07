"""BetterAuth JWT verification via JWKS.

Verifies BetterAuth session tokens using the JWKS endpoint.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import jwt

from app import config


_jwks_cache: dict[str, dict] = {}
_fetched_at: float = 0.0
_TTL_SECONDS = 3600  # 1 hour

async def _fetch_jwks() -> dict[str, dict]:
    """Fetch JWKS from BetterAuth and index by kid."""
    jwks_url = f"{config.BETTER_AUTH_URL}/api/auth/jwks"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(jwks_url)
        resp.raise_for_status()
        data = resp.json()
    
    keys = data.get("keys", [])
    return {
        key["kid"]: key
        for key in keys
        if isinstance(key, dict) and key.get("kid")
    }


async def _get_jwk_for_async(kid: str) -> dict | None:
    """Async version for FastAPI dependency injection."""
    global _fetched_at
    
    if kid not in _jwks_cache or (time.monotonic() - _fetched_at) > _TTL_SECONDS:
        try:
            _jwks_cache.update(await _fetch_jwks())
            _fetched_at = time.monotonic()
        except Exception:
            return None
    
    return _jwks_cache.get(kid)


async def verify_betterauth_token(token: str) -> dict[str, Any] | None:
    """Verify BetterAuth JWT and return claims dict. Returns None if invalid."""
    try:
        # Get kid from header
        headers = jwt.get_unverified_header(token)
        kid = headers.get("kid")
        if not kid:
            return None
        
        # Get JWK for kid
        jwk = await _get_jwk_for_async(kid)
        if not jwk:
            return None
        
        # Convert JWK to key object
        from jwt.algorithms import OKPAlgorithm
        try:
            jwk_obj = OKPAlgorithm.from_jwk(jwk)
        except Exception:
            # Try RSAAlgorithm for RS256 keys
            from jwt.algorithms import RSAAlgorithm
            try:
                jwk_obj = RSAAlgorithm.from_jwk(jwk)
            except Exception:
                return None
        
        # Decode and verify
        claims = jwt.decode(
            token,
            jwk_obj,
            algorithms=["EdDSA", "RS256"],
            options={"verify_aud": False},
            audience=None,
        )
        
        # Required claims
        if not claims.get("sub") or not claims.get("email"):
            return None
        
        return claims
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidSignatureError:
        return None
    except jwt.PyJWTError:
        return None
    except Exception:
        return None


__all__ = [
    "verify_betterauth_token",
]