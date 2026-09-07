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
    # our API uses. Copy the cookie header through; the upstream call
    # is on behalf of this very user.
    cookie = request.headers.get("cookie", "")
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
                headers={"Cookie": cookie} if cookie else {},
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
        try:
            data = resp.json()
            message = (
                data.get("message")
                if isinstance(data, dict) and isinstance(data.get("message"), str)
                else None
            )
        except Exception:
            message = None
        # 422 means the password didn't pass server-side policy (length,
        # character class). The frontend already enforces the same range;
        # this is the server's authoritative answer.
        code = "AUTH_VALIDATION" if resp.status_code == 422 else "AUTH_ERROR"
        return JSONResponse(  # type: ignore[return-value]
            status_code=resp.status_code,
            content=error_body(code, message or "Couldn't link password. Try again."),
        )

    logger.info("link-password: success user_id=%s", result.id)
    return {"ok": True}


# Re-export so any future router that needs the resolved user can import it
# from one place.
__all__ = ["router", "me", "logout", "link_password"]
