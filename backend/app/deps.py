"""Shared dependencies: current_user from BetterAuth JWT, origin check for mutations."""

from __future__ import annotations

import logging
from urllib.parse import urlparse

from fastapi import Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

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


def _resolve_user_sync(db: Session, sub: str, email: str, name: str) -> User:
    """Sync DB half of get_current_user (runs in Starlette's threadpool).

    The async caller awaits the JWKS verify on the loop, then hops here
    for the blocking SELECT/INSERT/COMMIT so the loop never parks on the
    sync SQLAlchemy driver. Sequential use only: one request, one hop,
    no concurrent access to the session.
    """
    user = _insert_or_select(
        db,
        lambda: db.query(User).filter(User.auth_user_id == sub).one_or_none(),
        lambda: User(
            auth_user_id=sub,
            email=email.lower().strip()[:254],
            display_name=name.strip()[:80],
        ),
    )
    # Display-name re-mirror (FR2, human-approved): BetterAuth owns the
    # name, and a rename via POST /api/auth/update-user touches no PESDac
    # write path — only the JWT `name` claim moves. Re-mirror here so
    # every authenticated read (notably GET /auth/me) converges without
    # a schema change. Write-only-on-diff: converged requests skip the
    # UPDATE entirely, and an empty claim never wipes a stored name.
    fresh_name = name.strip()[:80]
    if fresh_name and user.display_name != fresh_name:
        user.display_name = fresh_name
        db.commit()
        db.refresh(user)
    return user


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

    # Sync DB hop: the upsert + re-mirror block on the sync driver, so run
    # them in Starlette's threadpool instead of on the event loop. The JWKS
    # verify above stays awaited on the loop (true async I/O).
    user = await run_in_threadpool(_resolve_user_sync, db, sub, email, name)
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
    """Restrict mutating routes to known frontend origins (arch §9, T18).

    The session token is the proof of identity; this check still rejects
    cross-site form submissions that target our API.

    Policy:
    - Non-browser clients (tests, curl, server-to-server): missing
      Origin AND missing Referer is allowed. This is necessary for the
      test suite and any future backend-to-backend calls.
    - Browser mutations: BOTH Origin and Referer (when present) must be
      in the allowlist. We allow missing Origin (only Referer present)
      so curl with explicit Referer still works, but a browser always
      sends Origin for cross-origin requests.
    """
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return None
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    if origin is None and referer is None:
        return None  # non-browser client (tests, curl)
    allowed = {_origin_of(o) for o in config.FRONTEND_ORIGINS} - {""}
    # When origin header is present, it MUST be in the allowlist. A
    # browser always sends Origin on cross-origin XHR/fetch; allowing
    # origin-less requests is what test harnesses need.
    if origin is not None and _origin_of(origin) not in allowed:
        from app.schemas.common import error_body

        logger.warning(
            "403 %s %s origin=%s", request.method, request.url.path, origin
        )
        return JSONResponse(
            status_code=403,
            content=error_body("FORBIDDEN", "Origin not allowed."),
        )
    # If only Referer was sent (rare; legacy proxies), honor it too.
    if origin is None and referer is not None and _origin_of(referer) not in allowed:
        from app.schemas.common import error_body

        logger.warning(
            "403 %s %s referer=%s", request.method, request.url.path, referer
        )
        return JSONResponse(
            status_code=403,
            content=error_body("FORBIDDEN", "Origin not allowed."),
        )
    return None
