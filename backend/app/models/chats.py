"""Chat containers (no message bodies — deferred spec owns `messages`)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.users import JsonType, _utcnow


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(6), unique=True, nullable=False)
    subject: Mapped[str] = mapped_column(
        ForeignKey("subjects.code"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(34), nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    # Back-reference for User.chats delete cascade (see models/users.py).
    user: Mapped["User"] = relationship("User", back_populates="chats")
    # ORM-level delete cascade: `db.delete(chat)` removes its messages in
    # the same flush (mirrors User.chats). The DB FK carries
    # ondelete="CASCADE" too (prod safety net); the ORM path is what
    # makes the purge work on SQLite (tests) and portable generally.
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="chat", cascade="all, delete-orphan"
    )


class Message(Base):
    """One turn body inside a chat container (spec §3.1).

    `seq` is per-chat order, server-assigned (max+1 with retry on
    UNIQUE violation). `content` is a serialized Block payload
    (bubbles/attachments metadata as JSON, never blobs).
    """

    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[dict] = mapped_column(JsonType, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("chat_id", "seq", name="uq_messages_chat_seq"),
        CheckConstraint(
            "role IN ('user','assistant','system')", name="messages_role_check"
        ),
        Index("ix_messages_chat_seq", "chat_id", "seq"),
    )

    chat: Mapped["Chat"] = relationship("Chat", back_populates="messages")


class DemoState(Base):
    __tablename__ = "demo_state"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    demo_label: Mapped[str] = mapped_column(String(120), primary_key=True)
    display_title: Mapped[str | None] = mapped_column(String(34), nullable=True)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    # Back-reference for User.demo_states delete cascade (see models/users.py).
    user: Mapped["User"] = relationship("User", back_populates="demo_states")


# Canonical demo labels (frontend/src/lib/chat.ts CHAT_CODES keys). PUT with an
# unknown label → 422 so typos fail loudly instead of creating orphan rows.
DEMO_LABELS = frozenset({
    "OSI Model", "TCP vs UDP", "IP Addressing & Subnetting", "Routing Protocols",
    "Process Scheduling", "Deadlocks", "Virtual Memory", "File Systems",
    "Boolean Algebra", "K-Maps", "Sequential Circuits", "Flip-Flops",
    "Binary Trees", "Graph Algorithms", "Sorting Algorithms", "Dynamic Programming",
    "Matrices", "Differential Equations", "Probability", "Fourier Series",
})
