"""Shared dependencies: current_user from Neon JWT, origin check for mutations."""

from __future__ import annotations

import logging
from urllib.parse import urlparse

import jwt as pyjwt
from fastapi import Depends, Header, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.auth import neon
from app.db import get_db
from app.models.profiles import Profile
from app.models.users import User
from app.schemas.common import UNAUTHORIZED

logger = logging.getLogger("pesdac")


def _insert_or_select(db: Session, find, make):
    """SELECT-then-INSERT that survives a concurrent winner.

    Parallel first-login calls (the onboarding dialog fires /auth/me +
    /profiles/me together; dev StrictMode double-mounts effects) can all
    SELECT-miss and then all INSERT. The loser catches the
    IntegrityError, rolls back, and adopts the winner's row instead of
    500ing. Re-raises when the row still isn't there (a different error).
    """
    row = find()
    if row is not None:
        return row
    candidate = make()
    db.add(candidate)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        row = find()
        if row is None:
            raise
        logger.info("get-or-create race: adopted existing row")
        return row
    db.refresh(candidate)
    return candidate


def get_or_create_profile(db: Session, user: User) -> Profile:
    """Blank profile row for the user (created on first /me). Race-safe:
    parallel /auth/me + /profiles/me calls share one users row and must
    not PK-conflict on profiles either."""
    return _insert_or_select(
        db,
        lambda: db.get(Profile, user.id),
        lambda: Profile(
            user_id=user.id,
            display_name=user.display_name,
            email=user.email,
        ),
    )


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
    except pyjwt.ExpiredSignatureError:
        logger.debug("401 expired JWT")
        return JSONResponse(status_code=401, content=UNAUTHORIZED)
    except pyjwt.InvalidSignatureError:
        logger.debug("401 JWT bad signature")
        return JSONResponse(status_code=401, content=UNAUTHORIZED)
    except pyjwt.PyJWTError:
        logger.debug("401 JWT invalid")
        return JSONResponse(status_code=401, content=UNAUTHORIZED)
    sub = claims.get("sub", "")
    if not sub:
        return JSONResponse(status_code=401, content=UNAUTHORIZED)
    user = _insert_or_select(
        db,
        lambda: db.query(User).filter(User.neon_user_id == sub).one_or_none(),
        lambda: User(
            neon_user_id=sub,
            email=(claims.get("email") or "").strip().lower()[:254],
            display_name=(claims.get("name") or "").strip()[:80],
        ),
    )
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

        logger.warning(
            "403 %s %s origin=%s", request.method, request.url.path, origin
        )
        return JSONResponse(
            status_code=403,
            content=error_body("FORBIDDEN", "Origin not allowed."),
        )
    return None
