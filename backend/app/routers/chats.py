"""Chat containers (arch §7.3). Every query scoped by (user_id[, code]).
Cross-user code → 404 (no existence oracle). No message bodies in this slice.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import security
from app.db import get_db
from app.deps import check_mutation_origin, get_current_user
from app.models.chats import Chat
from app.schemas.chats import ChatCreate, ChatOut, ChatPatch
from app.schemas.common import error_body

router = APIRouter(prefix="/chats", tags=["chats"])


def _out(chat: Chat) -> dict:
    def _iso(dt: datetime) -> str:
        if dt.tzinfo is None:  # SQLite (tests) returns naive; prod is tz-aware
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()

    return {
        "code": chat.code, "subject": chat.subject, "title": chat.title,
        "isPinned": chat.is_pinned, "isArchived": chat.is_archived,
        "createdAt": _iso(chat.created_at), "updatedAt": _iso(chat.updated_at),
    }


def _get_owned(db: Session, user_id, code: str) -> Chat | None:
    return db.scalar(select(Chat).where(Chat.user_id == user_id, Chat.code == code))


@router.get("")
def list_chats(
    result=Depends(get_current_user),
    db: Session = Depends(get_db),
    archived: bool = False,
    subject: str | None = None,
    q: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    if isinstance(result, JSONResponse):
        return result
    stmt = select(Chat).where(Chat.user_id == result.id, Chat.is_archived.is_(archived))
    if subject:
        stmt = stmt.where(Chat.subject == subject)
    if q and q.strip():
        stmt = stmt.where(Chat.title.ilike(f"%{q.strip()}%"))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Chat.is_pinned.desc(), Chat.updated_at.desc()).limit(limit).offset(offset)
    ).all()
    return {"data": [_out(c) for c in rows], "pagination": {"limit": limit, "offset": offset, "total": total}}


@router.post("", status_code=201)
def create_chat(body: ChatCreate, request: Request, result=Depends(get_current_user), db: Session = Depends(get_db)):
    if isinstance(result, JSONResponse):
        return result
    if denied := check_mutation_origin(request):
        return denied
    for _ in range(5):
        code = security.gen_chat_code()
        if _get_owned(db, result.id, code) is None and db.scalar(select(Chat).where(Chat.code == code)) is None:
            chat = Chat(user_id=result.id, code=code, subject=body.subject, title=body.title)
            db.add(chat)
            try:
                db.commit()
            except Exception:
                db.rollback()
                continue
            db.refresh(chat)
            return JSONResponse(status_code=201, content=_out(chat))
    return JSONResponse(status_code=409, content=error_body("CODE_COLLISION", "Could not allocate a chat code. Retry."))


@router.patch("/{code}")
def patch_chat(code: str, body: ChatPatch, request: Request, result=Depends(get_current_user), db: Session = Depends(get_db)):
    if isinstance(result, JSONResponse):
        return result
    if denied := check_mutation_origin(request):
        return denied
    chat = _get_owned(db, result.id, code)
    if chat is None:
        return JSONResponse(status_code=404, content=error_body("NOT_FOUND", "Chat not found."))
    data = body.model_dump(exclude_unset=True)
    if data.get("title") is not None:
        chat.title = data["title"]
    if data.get("isPinned") is not None:
        chat.is_pinned = bool(data["isPinned"])
    if data.get("isArchived") is not None:
        chat.is_archived = bool(data["isArchived"])
        if chat.is_archived:
            chat.is_pinned = False  # archiving unpins (matches archiveChat)
    chat.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(chat)
    return _out(chat)


@router.delete("/{code}", status_code=204)
def delete_chat(code: str, request: Request, result=Depends(get_current_user), db: Session = Depends(get_db)):
    if isinstance(result, JSONResponse):
        return result
    if denied := check_mutation_origin(request):
        return denied
    chat = _get_owned(db, result.id, code)
    if chat is None:
        return JSONResponse(status_code=404, content=error_body("NOT_FOUND", "Chat not found."))
    db.delete(chat)
    db.commit()
    return Response(status_code=204)


@router.delete("", status_code=200)
def clear_chats(request: Request, result=Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete-all (mirrors clearAllChats): chats only, profile/demo kept."""
    if isinstance(result, JSONResponse):
        return result
    if denied := check_mutation_origin(request):
        return denied
    count = db.query(Chat).filter(Chat.user_id == result.id).delete()
    db.commit()
    return {"deleted": count}
