"""Shared dependencies: current_user from BetterAuth JWT, origin check for mutations."""

from __future__ import annotations

import logging
from urllib.parse import urlparse

from fastapi import Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.auth.betterauth import verify_betterauth_token
from app.db import get_db
from app.models.profiles import Profile
from app.models.users import User

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


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the current user from BetterAuth JWT.

    Extracts Bearer token, verifies via BetterAuth JWKS,
    and upserts our users row by the verified provider id.

    401s raised here are translated to the standard error envelope
    by the global HTTPException handler registered in app/main.py —
    so every 401 in the app has the same shape regardless of which
    dependency or route produced it.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Authentication required.")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required.")

    claims = await verify_betterauth_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired session.")

    sub = claims.get("sub")
    email = claims.get("email")
    name = claims.get("name") or ""
    if not sub or not email:
        raise HTTPException(status_code=401, detail="Invalid session claims.")
    
    user = _insert_or_select(
        db,
        lambda: db.query(User).filter(User.auth_user_id == sub).one_or_none(),
        lambda: User(
            auth_user_id=sub,
            email=email.lower().strip()[:254],
            display_name=name.strip()[:80],
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

    The session token is the proof of identity; this check still rejects
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
