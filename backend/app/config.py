"""Fail-fast environment configuration (v6 — Neon Auth).

Only these vars are read. Missing/invalid required values raise at
import so the process never boots half-configured. No secrets are logged.
"""

from __future__ import annotations

import os


def _get(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(name, default)
    if value is not None:
        value = value.strip()
        if value == "":
            return None
    return value


def _get_bool(name: str, default: bool) -> bool:
    raw = _get(name)
    if raw is None:
        return default
    return raw.lower() in ("1", "true", "yes", "on")


ENV: str = _get("ENV", "dev") or "dev"

DATABASE_URL: str | None = _get("DATABASE_URL")

# Neon Auth (Managed Better Auth in our Neon project). v6 backend is
# stateless about identity: we verify the access_token JWT against JWKS
# on every protected request.
NEON_AUTH_BASE_URL: str | None = _get("NEON_AUTH_BASE_URL")
NEON_AUTH_JWKS_URL: str | None = _get("NEON_AUTH_JWKS_URL")

_raw_origins: str | None = _get("FRONTEND_ORIGINS")
FRONTEND_ORIGINS: list[str] = (
    [o.strip().rstrip("/") for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else []
)

COOKIE_SECURE: bool = _get_bool("COOKIE_SECURE", True)

# Legacy defaults kept so any consumer that still references them
# doesn't crash. Auth-class rate limiting is now Neon-owned; the
# remaining values are reserved for future per-IP abuse protection on
# our chat/profile routes.
RATE_LIMIT_LOGIN: int = 10
RATE_LIMIT_SIGNUP: int = 5


def validate_startup(require_db: bool = True) -> None:
    """Called by the app factory (and alembic env). Raises on misconfiguration."""
    errors: list[str] = []
    if require_db and not DATABASE_URL:
        errors.append("DATABASE_URL is required")
    if not NEON_AUTH_BASE_URL:
        errors.append("NEON_AUTH_BASE_URL is required")
    if not NEON_AUTH_JWKS_URL:
        errors.append("NEON_AUTH_JWKS_URL is required")
    if not FRONTEND_ORIGINS:
        errors.append("FRONTEND_ORIGINS must list at least one origin")
    if not COOKIE_SECURE and any(
        o.startswith("https://") for o in FRONTEND_ORIGINS
    ):
        errors.append("COOKIE_SECURE=false with https origins is forbidden")
    if errors:
        raise RuntimeError("Backend misconfigured: " + "; ".join(errors))
