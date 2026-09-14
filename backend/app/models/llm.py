"""LLM BYOK credential rows (spec llm-byok-settings §4.1).

One row per (user, provider). Only the Fernet-encrypted key is stored,
plus a last-4 hint for `••••abcd` display — the raw key is never
readable from any response. Account delete cascades here via the ORM
relationship on User (SQLite/tests) and the DB FK (prod).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.users import _utcnow


class LlmCredential(Base):
    __tablename__ = "llm_credentials"
    __table_args__ = (
        UniqueConstraint("user_id", "provider",
                         name="uq_llm_credentials_user_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # v1: only "openrouter". Stored as a string (not enum) so future
    # providers need data, not DDL.
    provider: Mapped[str] = mapped_column(String(32), default="openrouter",
                                          nullable=False)
    # Fernet token (base64 str). Never logged, never returned.
    key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    # Last 4 chars of the raw key, for masked display only.
    key_hint: Mapped[str] = mapped_column(String(4), default="", nullable=False)
    model: Mapped[str] = mapped_column(String(120), default="openai/gpt-4o-mini",
                                       nullable=False)
    validated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                   default=_utcnow,
                                                   nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 default=_utcnow,
                                                 onupdate=_utcnow,
                                                 nullable=False)

    user: Mapped["User"] = relationship("User",
                                        back_populates="llm_credentials")
