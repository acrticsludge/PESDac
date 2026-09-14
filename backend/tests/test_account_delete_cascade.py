"""Account-delete cascade proof (audit §7 item 2, behavioral half).

Mirrors `DELETE /users/me` (`routers/users.py:78`: `db.delete(user)` +
commit) on SQLite, where the ORM-level `delete-orphan` cascades do the
work. Seeds two users with a full row fan-out (profile, chat, message,
demo-state, LLM credential), deletes one, and asserts the other user's
rows are untouched.

The DB-FK `ondelete="CASCADE"` half (prod safety net) cannot run
without a live Postgres, so it is pinned structurally instead: every
child FK in the models must carry `ondelete="CASCADE"`.
"""

from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db import Base
from app.models.catalog import SUBJECT_SEEDS, Subject
from app.models.chats import Chat, DemoState, Message
from app.models.llm import LlmCredential
from app.models.profiles import Profile
from app.models.users import User

_engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
_TestingSession = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)


def _seed_user(db, auth_id: str, email: str, code: str) -> User:
    user = User(auth_user_id=auth_id, email=email, display_name="Cascade")
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id))
    chat = Chat(user_id=user.id, code=code, subject="CN", title="Cascade chat")
    db.add(chat)
    db.flush()
    db.add(Message(chat_id=chat.id, seq=0, role="user", content={"t": "hi"}))
    db.add(DemoState(user_id=user.id, demo_label="OSI Model"))
    db.add(LlmCredential(user_id=user.id, provider="openrouter", key_encrypted="x"))
    return user


def _counts(db, user_id):
    return {
        "profile": db.query(Profile).filter(Profile.user_id == user_id).count(),
        "chats": db.query(Chat).filter(Chat.user_id == user_id).count(),
        "messages": db.query(Message).join(Chat).filter(Chat.user_id == user_id).count(),
        "demos": db.query(DemoState).filter(DemoState.user_id == user_id).count(),
        "llm": db.query(LlmCredential).filter(LlmCredential.user_id == user_id).count(),
    }


def test_delete_user_removes_all_owned_rows_and_spares_the_other_user():
    Base.metadata.drop_all(bind=_engine)
    Base.metadata.create_all(bind=_engine)
    db = _TestingSession()
    for code, name in SUBJECT_SEEDS:
        db.add(Subject(code=code, display_name=name))
    keep = _seed_user(db, "keep-sub", "keep@example.com", "KEEP01")
    gone = _seed_user(db, "gone-sub", "gone@example.com", "GONE02")
    db.commit()
    assert _counts(db, gone.id) == {
        "profile": 1, "chats": 1, "messages": 1, "demos": 1, "llm": 1,
    }

    # Same two lines as routers/users.py delete_me.
    user = db.get(User, gone.id)
    db.delete(user)
    db.commit()

    assert _counts(db, gone.id) == {
        "profile": 0, "chats": 0, "messages": 0, "demos": 0, "llm": 0,
    }
    assert db.get(User, gone.id) is None
    assert _counts(db, keep.id) == {
        "profile": 1, "chats": 1, "messages": 1, "demos": 1, "llm": 1,
    }
    db.close()


def test_every_child_fk_carries_ondelete_cascade():
    fks = []
    for table in Base.metadata.tables.values():
        for fk in table.foreign_keys:
            if fk.column.table.name == "users" and table.name != "users":
                fks.append((f"{table.name}.{fk.parent.name}", fk.ondelete))
    assert fks, "no child FKs found — model metadata did not load"
    missing = [name for name, ondelete in fks if (ondelete or "").upper() != "CASCADE"
               and "CASCADE" not in (ondelete or "").upper()]
    assert not missing, missing
