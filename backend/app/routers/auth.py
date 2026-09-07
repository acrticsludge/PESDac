"""Auth router (BetterAuth integration).

- `GET /me` returns the current user + onboarding state.
- `POST /logout` is a 204 no-op on our side.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_or_create_profile
from app.models.users import User

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


# Re-export so any future router that needs the resolved user can import it
# from one place.
__all__ = ["router", "me", "logout"]
