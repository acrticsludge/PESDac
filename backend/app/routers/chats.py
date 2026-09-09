"""Chat containers (arch §7.3). Every query scoped by (user_id[, code]).
Cross-user code → 404 (no existence oracle). No message bodies in this slice.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import rate_limit, security
from app.db import get_db
from app.deps import check_mutation_origin, get_current_user
from app.models.chats import Chat, Message
from app.models.users import User
from app.schemas.chats import ChatCreate, ChatPatch, MessageCreate
from app.schemas.common import error_body

router = APIRouter(prefix="/chats", tags=["chats"])


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:  # SQLite (tests) returns naive; prod is tz-aware
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _out(chat: Chat) -> dict:
    return {
        "code": chat.code, "subject": chat.subject, "title": chat.title,
        "isPinned": chat.is_pinned, "isArchived": chat.is_archived,
        "createdAt": _iso(chat.created_at), "updatedAt": _iso(chat.updated_at),
    }


def _msg_out(msg: Message) -> dict:
    return {
        "id": str(msg.id), "seq": msg.seq, "role": msg.role,
        "content": msg.content, "createdAt": _iso(msg.created_at),
    }


def _get_owned(db: Session, user_id, code: str) -> Chat | None:
    return db.scalar(select(Chat).where(Chat.user_id == user_id, Chat.code == code))


@router.get("")
async def list_chats(
    result: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    archived: bool = False,
    subject: str | None = None,
    q: str | None = None,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
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
async def create_chat(body: ChatCreate, request: Request, result: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("chats-create", request, 60, 60):
        return limited
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
async def patch_chat(code: str, body: ChatPatch, request: Request, result: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
async def delete_chat(code: str, request: Request, result: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    chat = _get_owned(db, result.id, code)
    if chat is None:
        return JSONResponse(status_code=404, content=error_body("NOT_FOUND", "Chat not found."))
    db.delete(chat)
    db.commit()
    return Response(status_code=204)


@router.delete("", status_code=200)
async def clear_chats(request: Request, result: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Delete-all (mirrors clearAllChats): chats only, profile/demo kept.

    Returns the same `{data, pagination}` envelope as `list_chats` so
    the frontend's `apiFetch<T>` consumer parses one shape for every
    chats endpoint. `pagination.total` is the number deleted, so
    the same `apiGetChats` query that loaded the rows can report
    the new total without an extra fetch.
    """
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("chats-clear", request, 10, 300):
        return limited
    count = db.query(Chat).filter(Chat.user_id == result.id).delete()
    db.commit()
    return {"data": {"deleted": count}, "pagination": {"limit": 0, "offset": 0, "total": count}}


@router.post("/{code}/messages", status_code=201)
async def append_message(code: str, body: MessageCreate, request: Request, result: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Append one turn body; `seq` is server-assigned (max+1, retry ×3).

    Cross-user, unknown, and demo/static codes all 404 with the same
    NOT_FOUND body as the container routes (no existence oracle).
    """
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("chat-messages-append", request, 60, 60):
        return limited
    chat = _get_owned(db, result.id, code)
    if chat is None:
        return JSONResponse(status_code=404, content=error_body("NOT_FOUND", "Chat not found."))
    for _ in range(3):
        next_seq = db.scalar(select(func.max(Message.seq)).where(Message.chat_id == chat.id))
        msg = Message(
            chat_id=chat.id,
            seq=0 if next_seq is None else next_seq + 1,
            role=body.role,
            content=body.content,
        )
        # Touch the container so sidebar ordering keeps working.
        chat.updated_at = datetime.now(timezone.utc)
        db.add(msg)
        try:
            db.commit()
        except IntegrityError:
            # Lost a concurrent append race: roll back and converge on
            # the winner's max (mirrors `_insert_or_select` doctrine).
            db.rollback()
            chat = _get_owned(db, result.id, code)
            if chat is None:
                return JSONResponse(status_code=404, content=error_body("NOT_FOUND", "Chat not found."))
            continue
        db.refresh(msg)
        db.refresh(chat)
        return JSONResponse(status_code=201, content=_msg_out(msg))
    return JSONResponse(status_code=409, content=error_body("CONFLICT", "Could not append message. Retry."))


@router.get("/{code}/messages")
async def list_messages(
    code: str,
    result: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=200, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
):
    """List turn bodies `seq`-ascending in the slice `{data, pagination}` envelope."""
    chat = _get_owned(db, result.id, code)
    if chat is None:
        return JSONResponse(status_code=404, content=error_body("NOT_FOUND", "Chat not found."))
    total = db.scalar(select(func.count()).select_from(Message).where(Message.chat_id == chat.id)) or 0
    rows = db.scalars(
        select(Message).where(Message.chat_id == chat.id).order_by(Message.seq.asc()).limit(limit).offset(offset)
    ).all()
    return {"data": [_msg_out(m) for m in rows], "pagination": {"limit": limit, "offset": offset, "total": total}}


@router.delete("/{code}/messages")
async def truncate_messages(
    code: str,
    request: Request,
    result: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    from_seq: int = Query(ge=0),
):
    """Delete the tail (`seq >= from_seq`); mirrors `clear_chats` envelope."""
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("chat-messages-truncate", request, 60, 60):
        return limited
    chat = _get_owned(db, result.id, code)
    if chat is None:
        return JSONResponse(status_code=404, content=error_body("NOT_FOUND", "Chat not found."))
    count = (
        db.query(Message)
        .filter(Message.chat_id == chat.id, Message.seq >= from_seq)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"data": {"deleted": count}, "pagination": {"limit": 0, "offset": 0, "total": count}}
