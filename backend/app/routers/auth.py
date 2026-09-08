"""Auth router (BetterAuth integration).

- `GET /me` returns the current user + onboarding state.
- `POST /logout` is a 204 no-op on our side.
- `POST /link-password` attaches an email+password credential to a
  Google-only account via BetterAuth's serverOnly setPassword route
  (no client-side equivalent in 1.7.3).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app import config, rate_limit
from app.db import get_db
from app.deps import (
    check_mutation_origin,
    get_current_user,
    get_or_create_profile,
)
from app.models.users import User
from app.schemas.auth import LinkPasswordIn
from app.schemas.common import error_body

logger = logging.getLogger("pesdac")

router = APIRouter(prefix="/auth", tags=["auth"])

# BetterAuth (1.7.3, no custom cookie prefix in lib/auth.ts) names its
# session cookies `better-auth.<name>` (session_token, session_data, ...).
# On secure/production deployments the same names carry a `__Secure-` (or
# `__Host-`) prefix, and the reader also accepts the `-` separator
# variant — all of these must travel upstream. Only these are forwarded —
# never the whole Cookie header (analytics or other first-party cookies
# must not leave our boundary).
_BETTER_AUTH_COOKIE_PREFIXES = ("better-auth.", "better-auth-")
_SECURE_COOKIE_PREFIXES = ("__secure-", "__host-")


def _session_cookie_header(raw: str) -> dict[str, str]:
    """Reduce a `Cookie` header to the BetterAuth session cookies.

    Parses `name=value` pairs and keeps only the BetterAuth session
    names (secure-prefixed and `-`-separator variants included);
    returns `{}` when nothing session-scoped remains so the caller
    sends no Cookie header at all. Original pairs are forwarded
    verbatim (only surrounding whitespace is trimmed).
    """
    kept: list[str] = []
    for part in raw.split(";"):
        name, sep, value = part.strip().partition("=")
        if not sep or not name:
            continue
        name = name.strip()
        matchable = name.lower()
        for secure in _SECURE_COOKIE_PREFIXES:
            if matchable.startswith(secure):
                matchable = matchable[len(secure):]
                break
        if matchable.startswith(_BETTER_AUTH_COOKIE_PREFIXES):
            kept.append(f"{name}={value.strip()}")
    return {"Cookie": "; ".join(kept)} if kept else {}


@router.get("/me")
async def me(
    result: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the current user + onboardingDone."""
    user: User = result
    profile = get_or_create_profile(db, user)
    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "displayName": user.display_name,
            "onboardingDone": bool(profile.onboarding_done),
        }
    }


@router.post("/logout", status_code=204)
def logout():
    """No-op on our side. The frontend clears its session state."""
    return Response(status_code=204)


@router.post("/link-password")
async def link_password(
    request: Request,
    body: LinkPasswordIn,
    result: User = Depends(get_current_user),
) -> dict[str, Any]:
    """Attach a credential password to the current user.

    Google-only users have no password — the only way to add one in
    BetterAuth 1.7.3 is the serverOnly `setPassword` route. We proxy
    the call here carrying the session cookie; BetterAuth validates
    it server-side and writes the new credential account row.

    The request itself is gated by:
    - the BetterAuth JWT (get_current_user)
    - the same origin check as DELETE /users/me
    - a per-IP rate limit (5 / 5 min) so a compromised token can't
      churn password set calls.
    """
    if denied := check_mutation_origin(request):
        return denied  # type: ignore[return-value]
    if limited := rate_limit.check("auth-link-password", request, 5, 300):
        return limited  # type: ignore[return-value]

    # BetterAuth verifies the SESSION COOKIE server-side, not the JWT
    # our API uses. Forward only the BetterAuth session cookies on
    # behalf of this very user; anything else in the Cookie header
    # stays on our side of the boundary.
    cookie = request.headers.get("cookie", "")
    forward_headers = _session_cookie_header(cookie)
    upstream = (
        f"{config.BETTER_AUTH_URL}/api/auth/set-password"
        if config.BETTER_AUTH_URL
        else None
    )
    if not upstream:
        logger.error("link-password: BETTER_AUTH_URL not set")
        return JSONResponse(  # type: ignore[return-value]
            status_code=500,
            content=error_body("INTERNAL", "Auth service not configured."),
        )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                upstream,
                json={"newPassword": body.newPassword},
                headers=forward_headers,
            )
    except httpx.HTTPError:
        logger.warning("link-password: upstream unreachable")
        return JSONResponse(  # type: ignore[return-value]
            status_code=502,
            content=error_body("AUTH_UNREACHABLE", "Authentication service unavailable."),
        )

    if not resp.is_success:
        # Surface BetterAuth's user-safe error message; never leak the
        # upstream status or raw body (it can include internal codes).
        data: Any = None
        try:
            data = resp.json()
        except Exception:
            data = None
        message: str | None = None
        if isinstance(data, dict):
            raw_message = data.get("message")
            if isinstance(raw_message, str) and raw_message:
                message = raw_message
        # 422 means the password didn't pass server-side policy (length,
        # character class). The frontend already enforces the same range;
        # this is the server's authoritative answer.
        code = "AUTH_VALIDATION" if resp.status_code == 422 else "AUTH_ERROR"
        backend_status = resp.status_code
        if resp.status_code == 401:
            # Upstream rejected the session cookie while our JWT is valid.
            # A backend 401 would make apiFetch fire the global
            # `pesdac:auth-required` logout (navigating to /login and
            # clearing the session) for a recoverable cookie problem, so
            # remap it: 500 AUTH_ERROR toasts recoverably in the open
            # modal instead. Upstream status stays in the server log only.
            logger.warning(
                "link-password: upstream rejected session cookie user_id=%s",
                result.id,
            )
            backend_status = 500
        return JSONResponse(  # type: ignore[return-value]
            status_code=backend_status,
            content=error_body(code, message or "Couldn't link password. Try again."),
        )

    logger.info("link-password: success user_id=%s", result.id)
    return {"ok": True}


# Re-export so any future router that needs the resolved user can import it
# from one place.
__all__ = ["router", "me", "logout", "link_password"]
