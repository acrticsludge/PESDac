"""Shared dependencies: current_user (access-cookie JWT), origin check for mutations."""

from __future__ import annotations

import uuid

from fastapi import Cookie, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app import config, security
from app.db import get_db
from app.models.users import User
from app.schemas.common import UNAUTHORIZED, error_body


def get_current_user(
    pesdac_at: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User | JSONResponse:
    if not pesdac_at:
        return JSONResponse(status_code=401, content=UNAUTHORIZED)
    user_id = security.decode_access_token(pesdac_at)
    if not user_id:
        return JSONResponse(status_code=401, content=UNAUTHORIZED)
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        return JSONResponse(status_code=401, content=UNAUTHORIZED)
    user = db.get(User, uid)
    if user is None:
        return JSONResponse(status_code=401, content=UNAUTHORIZED)
    return user


def require_user(result: User | JSONResponse) -> User:
    if isinstance(result, JSONResponse):
        # Routers return this directly; helper keeps handlers flat.
        raise _Unauthorized(result)
    return result


class _Unauthorized(Exception):
    def __init__(self, response: JSONResponse):
        self.response = response


def check_mutation_origin(request: Request) -> JSONResponse | None:
    """SameSite=Lax + strict Origin/Referer allowlist on mutating routes (arch §9)."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return None
    origin = request.headers.get("origin") or request.headers.get("referer")
    if not origin:
        return None  # non-browser client (tests, curl) — cookies still required
    allowed = any(origin.startswith(o) for o in config.FRONTEND_ORIGINS)
    if not allowed:
        return JSONResponse(
            status_code=403,
            content=error_body("FORBIDDEN", "Origin not allowed."),
        )
    return None
