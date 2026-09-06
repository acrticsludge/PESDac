"""Shared dependencies: current_user from Neon JWT, origin check for mutations."""

from __future__ import annotations

from urllib.parse import urlparse

import jwt as pyjwt
from fastapi import Depends, Header, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app import config
from app.auth import neon
from app.db import get_db
from app.models.users import User
from app.schemas.common import UNAUTHORIZED


def get_current_user_from_neon(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User | JSONResponse:
    """Verify `Authorization: Bearer <Neon JWT>` and upsert our users row.

    First call for a given `sub` creates our row + blank profile (the
    profile row is created on first /me, not here, to keep this dep
    side-effect-light). Subsequent calls return the existing row.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return JSONResponse(status_code=401, content=UNAUTHORIZED)
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return JSONResponse(status_code=401, content=UNAUTHORIZED)
    try:
        claims = neon.verify_neon_jwt(token)
    except pyjwt.PyJWTError:
        return JSONResponse(status_code=401, content=UNAUTHORIZED)
    sub = claims.get("sub", "")
    if not sub:
        return JSONResponse(status_code=401, content=UNAUTHORIZED)
    user = db.query(User).filter(User.neon_user_id == sub).one_or_none()
    if user is None:
        email = (claims.get("email") or "").strip().lower()[:254]
        name = (claims.get("name") or "").strip()[:80]
        user = User(neon_user_id=sub, email=email, display_name=name)
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def _origin_of(value: str) -> str:
    """Reduce an Origin/Referer header to `scheme://host[:port]`.

    Prefix matching is a bypass (`http://localhost:4321.evil.com`
    startswith the allowed origin), so compare exact origins only.
    """
    parts = urlparse(value)
    if not parts.scheme or not parts.netloc:
        return ""
    return f"{parts.scheme}://{parts.netloc}".lower()


def check_mutation_origin(request: Request) -> JSONResponse | None:
    """Restrict mutating routes to known frontend origins (arch §9).

    We no longer have cookie-based auth (Neon owns the session), so the
    bearer JWT is the proof of identity; this check still rejects
    cross-site form submissions that target our API.
    """
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return None
    origin = request.headers.get("origin") or request.headers.get("referer")
    if not origin:
        return None  # non-browser client (tests, curl)
    allowed = {_origin_of(o) for o in config.FRONTEND_ORIGINS} - {""}
    if _origin_of(origin) not in allowed:
        from app.schemas.common import error_body

        return JSONResponse(
            status_code=403,
            content=error_body("FORBIDDEN", "Origin not allowed."),
        )
    return None
