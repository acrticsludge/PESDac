"""Self-service data (arch §7.5): server-side export + delete-account cascade."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
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
def export_me(result=Depends(get_current_user), db: Session = Depends(get_db)):
    if isinstance(result, JSONResponse):
        return result
    assert isinstance(result, User)
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


@router.delete("/me", status_code=202)
def delete_me(request: Request, result=Depends(get_current_user), db: Session = Depends(get_db)):
    if isinstance(result, JSONResponse):
        return result
    if denied := check_mutation_origin(request):
        return denied
    user = db.get(User, result.id)
    assert user is not None
    db.delete(user)  # cascades: profile, chats, demo_state, tokens
    db.commit()
    resp = JSONResponse(status_code=202, content={})
    resp.delete_cookie(config.ACCESS_COOKIE, path="/")
    resp.delete_cookie(config.REFRESH_COOKIE, path="/api/v1/auth")
    return resp
