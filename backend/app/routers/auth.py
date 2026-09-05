"""Auth router (v6 — Neon Auth). Stateless about identity.

- `GET /me` verifies the Neon JWT (via get_current_user_from_neon), upserts
  our `users` row by `neon_user_id` (the JWT `sub`), and returns the
  resulting user + onboarding state.
- `POST /logout` is a 204 no-op on our side; the frontend calls
  `authClient.signOut()` to clear the Neon session.

No password / refresh / OAuth / reset endpoints — those live in Neon.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import security
from app.db import get_db
from app.deps import get_current_user_from_neon
from app.models.profiles import Profile
from app.models.users import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
def me(
    result=Depends(get_current_user_from_neon),
    db: Session = Depends(get_db),
):
    """Verify the Neon JWT, upsert our users row, return user + onboardingDone."""
    from fastapi.responses import JSONResponse as JR

    if isinstance(result, JR):
        return result
    user: User = result
    profile = db.get(Profile, user.id)
    if profile is None:
        profile = Profile(user_id=user.id, display_name=user.display_name, email=user.email)
        db.add(profile)
        db.commit()
        db.refresh(profile)
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
    """No-op on our side. The frontend SDK invalidates the Neon session."""
    return Response(status_code=204)


# Re-export so any future router that needs the resolved user can import it
# from one place.
__all__ = ["router", "me", "logout"]
