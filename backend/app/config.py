"""Fail-fast environment configuration (arch doc §6).

Only these vars are read. Missing/invalid required values raise at import so
the process never boots half-configured. No secrets are logged.
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


def _get_int(name: str, default: int) -> int:
    raw = _get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid integer for {name}: {raw!r}") from exc


def _get_bool(name: str, default: bool) -> bool:
    raw = _get(name)
    if raw is None:
        return default
    return raw.lower() in ("1", "true", "yes", "on")


ENV: str = _get("ENV", "dev") or "dev"

DATABASE_URL: str | None = _get("DATABASE_URL")
JWT_SECRET: str | None = _get("JWT_SECRET")
ACCESS_TTL_MIN: int = _get_int("ACCESS_TTL_MIN", 15)
REFRESH_TTL_DAYS: int = _get_int("REFRESH_TTL_DAYS", 30)

_raw_origins: str | None = _get("FRONTEND_ORIGINS")
FRONTEND_ORIGINS: list[str] = (
    [o.strip().rstrip("/") for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else []
)

COOKIE_SECURE: bool = _get_bool("COOKIE_SECURE", True)

GOOGLE_CLIENT_ID: str | None = _get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET: str | None = _get("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI: str | None = _get("GOOGLE_REDIRECT_URI")

RESEND_API_KEY: str | None = _get("RESEND_API_KEY")
RESET_MAIL_FROM: str | None = _get("RESET_MAIL_FROM")

RATE_LIMIT_LOGIN: int = _get_int("RATE_LIMIT_LOGIN", 10)
RATE_LIMIT_SIGNUP: int = _get_int("RATE_LIMIT_SIGNUP", 5)

ACCESS_COOKIE = "pesdac_at"
REFRESH_COOKIE = "pesdac_rt"
OAUTH_STATE_COOKIE = "pesdac_oauth_state"


def google_configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI)


def validate_startup(require_db: bool = True) -> None:
    """Called by the app factory (and alembic env). Raises on misconfiguration."""
    errors: list[str] = []
    if require_db and not DATABASE_URL:
        errors.append("DATABASE_URL is required")
    if not JWT_SECRET:
        errors.append("JWT_SECRET is required")
    elif len(JWT_SECRET) < 32:
        errors.append("JWT_SECRET must be at least 32 characters")
    if not FRONTEND_ORIGINS:
        errors.append("FRONTEND_ORIGINS must list at least one origin")
    if not COOKIE_SECURE and any(
        o.startswith("https://") for o in FRONTEND_ORIGINS
    ):
        errors.append("COOKIE_SECURE=false with https origins is forbidden")
    if errors:
        raise RuntimeError("Backend misconfigured: " + "; ".join(errors))
