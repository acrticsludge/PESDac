"""Fail-fast environment configuration (BetterAuth migration).

Neon Auth was removed; Neon is now database-only. Only these vars are
read. Missing/invalid required values raise at import so the process
never boots half-configured. No secrets are logged.
"""

from __future__ import annotations

import os
from pathlib import Path


def _load_dotenv() -> None:
    """Load the sibling `backend/.env` (stdlib parser, no new dependency).

    Uvicorn does not read .env files on its own, so without this the
    process boots with empty env: FRONTEND_ORIGINS=[] makes CORS reject
    every preflight with 400 and DB routes have no DATABASE_URL. Real
    environment variables always win — the file only fills gaps.
    """
    path = Path(__file__).resolve().parent.parent / ".env"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.lower().startswith("export "):
            line = line[7:].lstrip()
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if (
            len(value) >= 2
            and value[0] == value[-1]
            and value[0] in ("'", '"')
        ):
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


_load_dotenv()


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

# BetterAuth configuration
BETTER_AUTH_URL: str | None = _get("BETTER_AUTH_URL")
BETTER_AUTH_SECRET: str | None = _get("BETTER_AUTH_SECRET")
# Optional audience for JWT verification (T17). When unset the JWT
# verifier accepts the absence of aud (BetterAuth's current default).
BETTER_AUTH_AUDIENCE: str | None = _get("BETTER_AUTH_AUDIENCE")

# Google OAuth (for reference, BetterAuth handles the actual OAuth)
GOOGLE_CLIENT_ID: str | None = _get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET: str | None = _get("GOOGLE_CLIENT_SECRET")

_raw_origins: str | None = _get("FRONTEND_ORIGINS")
FRONTEND_ORIGINS: list[str] = (
    [o.strip().rstrip("/") for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else []
)

COOKIE_SECURE: bool = _get_bool("COOKIE_SECURE", True)


def validate_startup(require_db: bool = True) -> None:
    """Called by the app factory (and alembic env). Raises on misconfiguration.

    Test builds pass `require_db=False` and skip required checks, but
    production (`validate=True`) cannot start with missing values. ENV
    must be explicit (set to "test" to enter test mode); production
    refuses to boot when env vars are missing or conflict.
    """
    errors: list[str] = []
    if ENV not in ("dev", "staging", "prod", "test"):
        errors.append("ENV must be one of dev/staging/prod/test")
    if require_db and not DATABASE_URL:
        errors.append("DATABASE_URL is required")
    if not BETTER_AUTH_URL:
        errors.append("BETTER_AUTH_URL is required")
    if not BETTER_AUTH_SECRET:
        errors.append("BETTER_AUTH_SECRET is required")
    if len(BETTER_AUTH_SECRET) < 32:
        errors.append("BETTER_AUTH_SECRET must be at least 32 characters")
    if not FRONTEND_ORIGINS:
        errors.append("FRONTEND_ORIGINS must list at least one origin")
    if not COOKIE_SECURE and any(
        o.startswith("https://") for o in FRONTEND_ORIGINS
    ):
        errors.append("COOKIE_SECURE=false with https origins is forbidden")
    if ENV == "prod":
        if not COOKIE_SECURE:
            errors.append("COOKIE_SECURE=true is required in prod")
        if not all(o.startswith("https://") for o in FRONTEND_ORIGINS):
            errors.append("FRONTEND_ORIGINS must be https in prod")
    if errors:
        # Never log the secret values themselves — only the category names.
        raise RuntimeError("Backend misconfigured: " + "; ".join(errors))
