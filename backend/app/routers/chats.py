"""Chat containers (arch §7.3). Every query scoped by (user_id[, code]).
Cross-user code → 404 (no existence oracle). No message bodies in this slice.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import rate_limit, security
from app.db import get_db
from app.deps import check_mutation_origin, get_current_user
from app.models.chats import Chat, Message
from app.models.profiles import Profile
from app.models.users import User
from app.schemas.chats import ChatCreate, ChatPatch, MessageCreate
from app.schemas.common import error_body

router = APIRouter(prefix="/chats", tags=["chats"])

# Latest-turn snippet cap (spec FR2: preview TEXT <= 280 chars).
PREVIEW_MAX_CHARS = 280

# Render-only Block keys (spec FR1 — stripped client-side by Stream B).
# Excluded from previews so pre-strip rows don't leak timestamps/footers;
# structural keys (from/type/...) excluded so the snippet is prose only.
_PREVIEW_SKIP_KEYS = frozenset({
    "time", "toolCallsExpanded", "toolCallsAfter", "footer",
    "retryText", "from", "type", "variant", "language",
    "artifactId", "id", "mime", "file", "src",
})


def _preview_from_content(content: object, limit: int = PREVIEW_MAX_CHARS) -> str:
    """Flatten a stored Block payload to a <=280-char prose snippet."""
    parts: list[str] = []

    def walk(node: object) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in _PREVIEW_SKIP_KEYS:
                    continue
                walk(value)
        elif isinstance(node, (list, tuple)):
            for value in node:
                walk(value)
        elif isinstance(node, str):
            text = " ".join(node.split())
            if text:
                parts.append(text)

    walk(content)
    return " ".join(parts)[:limit]


# Nightly-purge windows per profiles.retention (models/profiles.py
# RETENTIONS — note the spec FR4 names `30d | 90d | 1y` do NOT match the
# shipped values; the code values below rule). "forever" keeps everything
# and is absent by design; "session" purges anything older than the run.
RETENTION_MAX_AGE = {
    "1 year": timedelta(days=365),
    "30 days": timedelta(days=30),
    "session": timedelta(days=0),
}

# Phase 4 (T4c): user-id chunk size for the purge bulk DELETEs — keeps
# each statement short and transactions small.
_PURGE_CHUNK = 500


def _as_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:  # SQLite (tests) returns naive; prod is tz-aware
        return dt.replace(tzinfo=timezone.utc)
    return dt


def purge_expired_chats(db: Session, now: datetime | None = None) -> dict[str, int]:
    """Nightly-purge worker body (FR4): delete per-user chats older than
    their `profiles.retention` window. Cutoff is pushed into the WHERE
    clause and deletes run as chunked bulk statements (Phase 4 T4c) —
    no Python-side filter, no per-row delete, short transactions.
    Messages are deleted first in SQL so SQLite (tests; FK enforcement
    off) never orphans rows — prod has the DB FK cascade as well.
    No scheduler is wired — there is no job infra in this repo (see
    final report); call this from the nightly runner when one lands.
    Returns `{retention: deleted}` for the windows that had users.
    """
    moment = _as_aware(now) if now is not None else datetime.now(timezone.utc)
    purged: dict[str, int] = {}
    for retention, max_age in RETENTION_MAX_AGE.items():
        cutoff = moment - max_age
        user_ids = db.scalars(
            select(Profile.user_id).where(Profile.retention == retention)
        ).all()
        if not user_ids:
            continue
        count = 0
        for i in range(0, len(user_ids), _PURGE_CHUNK):
            chunk = user_ids[i:i + _PURGE_CHUNK]
            stale_ids = select(Chat.id).where(
                Chat.user_id.in_(chunk), Chat.updated_at < cutoff
            )
            db.execute(delete(Message).where(Message.chat_id.in_(stale_ids)))
            res = db.execute(
                delete(Chat).where(
                    Chat.user_id.in_(chunk), Chat.updated_at < cutoff
                )
            )
            count += res.rowcount or 0
        purged[retention] = count
    if any(purged.values()):
        db.commit()
    return purged


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:  # SQLite (tests) returns naive; prod is tz-aware
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _out(chat: Chat) -> dict:
    return {
        "code": chat.code, "subject": chat.subject, "title": chat.title,
        "isPinned": chat.is_pinned, "isArchived": chat.is_archived,
        "createdAt": _iso(chat.created_at), "updatedAt": _iso(chat.updated_at),
        # getattr fallbacks: pre-0007 rows (or branches without the
        # migration) render as title-only rows — rollback-safe per §13.
        "preview": getattr(chat, "preview", None) or "",
        "msgCount": getattr(chat, "msg_count", None) or 0,
        "lastSeq": getattr(chat, "last_seq", None) or 0,
    }


def _msg_out(msg: Message) -> dict:
    return {
        "id": str(msg.id), "seq": msg.seq, "role": msg.role,
        "content": msg.content, "createdAt": _iso(msg.created_at),
    }


def _get_owned(db: Session, user_id, code: str) -> Chat | None:
    return db.scalar(select(Chat).where(Chat.user_id == user_id, Chat.code == code))


@router.get("")
def list_chats(
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
def create_chat(body: ChatCreate, request: Request, result: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("chats-create", request, 60, 60):
        return limited
    # Adopt idempotency (caching Phase 5, spec §10.2): a retried adopt
    # resends the same `clientAdoptKey` — return the existing row as
    # `200` in the exact list shape instead of creating a duplicate.
    # The per-user unique constraint (`uq_chats_user_adopt_key`) is the
    # race safety net; NULL keys (ordinary creates) never conflict.
    adopt_key = body.clientAdoptKey
    if adopt_key is not None:
        existing = db.scalar(
            select(Chat).where(
                Chat.user_id == result.id, Chat.client_adopt_key == adopt_key
            )
        )
        if existing is not None:
            return JSONResponse(status_code=200, content=_out(existing))
    for _ in range(5):
        code = security.gen_chat_code()
        if _get_owned(db, result.id, code) is None and db.scalar(select(Chat).where(Chat.code == code)) is None:
            chat = Chat(user_id=result.id, code=code, subject=body.subject, title=body.title, client_adopt_key=adopt_key)
            db.add(chat)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                # Lost an adopt race: the winner's row is the truth.
                if adopt_key is not None:
                    winner = db.scalar(
                        select(Chat).where(
                            Chat.user_id == result.id,
                            Chat.client_adopt_key == adopt_key,
                        )
                    )
                    if winner is not None:
                        return JSONResponse(status_code=200, content=_out(winner))
                continue
            except Exception:
                db.rollback()
                continue
            db.refresh(chat)
            return JSONResponse(status_code=201, content=_out(chat))
    return JSONResponse(status_code=409, content=error_body("CODE_COLLISION", "Could not allocate a chat code. Retry."))


@router.patch("/{code}")
def patch_chat(code: str, body: ChatPatch, request: Request, result: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
def delete_chat(code: str, request: Request, result: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    chat = _get_owned(db, result.id, code)
    if chat is None:
        return JSONResponse(status_code=404, content=error_body("NOT_FOUND", "Chat not found."))
    db.delete(chat)
    db.commit()
    return Response(status_code=204)


@router.delete("", status_code=200)
def clear_chats(request: Request, result: User = Depends(get_current_user), db: Session = Depends(get_db)):
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
def append_message(code: str, body: MessageCreate, request: Request, result: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Append one turn body; `seq` is server-assigned (max+1, retry ×3).

    Slim path (Phase 5 T5-pre): one MAX query per attempt — no COUNT
    (dense `seq` from 0 ⇒ count is `next_seq + 1`), no post-commit
    refreshes (the response is built from the flushed row). Correct with
    or without the Phase 4 index (the index only speeds the MAX query).

    Idempotency (Phase 5 T5a, mirrors the `clientAdoptKey` precedent):
    a retried append resends the same `clientMsgKey` — return the
    existing row as `200` instead of appending a duplicate. The
    per-chat unique constraint (`uq_messages_chat_client_key`) is the
    race safety net; NULL keys (appends without a key) never conflict.
    The `(chat_id, seq)` unique constraint stays the seq race safety
    net (lost race ⇒ rollback, converge on the winner's max).

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
    msg_key = body.clientMsgKey
    if msg_key is not None:
        existing = db.scalar(
            select(Message).where(
                Message.chat_id == chat.id, Message.client_msg_key == msg_key
            )
        )
        if existing is not None:
            return JSONResponse(status_code=200, content=_msg_out(existing))
    for _ in range(3):
        next_seq = db.scalar(select(func.max(Message.seq)).where(Message.chat_id == chat.id))
        next_seq = 0 if next_seq is None else next_seq + 1
        msg = Message(
            chat_id=chat.id,
            seq=next_seq,
            role=body.role,
            content=body.content,
            client_msg_key=msg_key,
        )
        # Touch the container so sidebar ordering keeps working; the
        # lean-list columns ride the same txn (FR2). `seq` is dense from
        # 0 (truncate only deletes the tail), so the count derives from
        # the assigned seq — no COUNT query.
        chat.updated_at = datetime.now(timezone.utc)
        chat.msg_count = next_seq + 1
        chat.last_seq = next_seq
        chat.preview = _preview_from_content(body.content)
        db.add(msg)
        try:
            # Flush first: the 201 body is built from the flushed row,
            # so the commit below costs no refresh SELECTs.
            db.flush()
            payload = _msg_out(msg)
            db.commit()
        except IntegrityError:
            # Lost a concurrent append race (seq) or a keyed retry race
            # (client key): roll back and converge — a keyed winner is
            # the truth (return it as 200), otherwise retry on the
            # winner's max (mirrors `_insert_or_select` doctrine).
            db.rollback()
            chat = _get_owned(db, result.id, code)
            if chat is None:
                return JSONResponse(status_code=404, content=error_body("NOT_FOUND", "Chat not found."))
            if msg_key is not None:
                winner = db.scalar(
                    select(Message).where(
                        Message.chat_id == chat.id,
                        Message.client_msg_key == msg_key,
                    )
                )
                if winner is not None:
                    return JSONResponse(status_code=200, content=_msg_out(winner))
            continue
        return JSONResponse(status_code=201, content=payload)
    return JSONResponse(status_code=409, content=error_body("CONFLICT", "Could not append message. Retry."))


@router.get("/{code}/messages")
def list_messages(
    code: str,
    result: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    # Phase 4 (T4b): smaller default page (was 200 x up-to-100KB bodies
    # ≈ 20MB worst case); `le=200` ceiling and the slice envelope stay.
    limit: int = Query(default=50, ge=1, le=200),
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
def truncate_messages(
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
    # Recompute the lean-list columns in the same txn (FR2) + touch
    # ordering so the sidebar reflects the truncation.
    remaining = db.scalars(
        select(Message)
        .where(Message.chat_id == chat.id)
        .order_by(Message.seq.desc())
        .limit(1)
    ).all()
    chat.msg_count = (
        db.scalar(select(func.count()).select_from(Message).where(Message.chat_id == chat.id)) or 0
    )
    if remaining:
        chat.last_seq = remaining[0].seq
        chat.preview = _preview_from_content(remaining[0].content)
    else:
        chat.last_seq = 0
        chat.preview = ""
    chat.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"data": {"deleted": count}, "pagination": {"limit": 0, "offset": 0, "total": count}}
