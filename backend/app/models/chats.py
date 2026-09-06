"""Chat containers (no message bodies — deferred spec owns `messages`)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.users import _utcnow


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
