"""Self-service data (arch §7.5): server-side export + delete-account cascade.

T22/T31 idempotency:
- export is read-only and always returns the user's current rows.
- DELETE /users/me is idempotent — a 204 is returned whether the user
  existed or not. This makes the chosen "backend first, then identity"
  deletion contract (frontend/src/lib/auth.ts: apiDeleteAccount) safe to
  retry: if the identity delete succeeds but the frontend retries the
  backend call before clearing caches, we still answer 204.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import rate_limit
from app.db import get_db
from app.deps import check_mutation_origin, get_current_user
from app.models.chats import Chat, DemoState
from app.models.profiles import Profile
from app.models.users import User
from app.routers.chats import _out as _chat_out
from app.routers.demo_state import _out as _demo_out
from app.schemas.profiles import profile_to_out

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me/export")
async def export_me(result: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.get(Profile, result.id)
    chats = db.scalars(select(Chat).where(Chat.user_id == result.id).order_by(Chat.created_at)).all()
    demos = db.scalars(select(DemoState).where(DemoState.user_id == result.id)).all()
    return {
        "profile": profile_to_out(profile) if profile else None,
        "chats": [_chat_out(c) for c in chats],
        "demoState": [_demo_out(d) for d in demos],
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "version": 1,
    }


@router.delete("/me", status_code=204)
async def delete_me(request: Request, result: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("users-delete", request, 10, 300):
        return limited
    # T22 idempotency: missing row is the same as "already deleted" — 204
    # either way, so the frontend retry-after-partial-delete contract is
    # safe. The current user_id here is the JWT subject (verified), not
    # a path param, so cross-user access is impossible.
    user = db.get(User, result.id)
    if user is not None:
        db.delete(user)  # cascades: profile, chats, demo_state
        db.commit()
    return Response(status_code=204)
