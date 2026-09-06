"""Profile 1:1 with users. Defaults mirror DEFAULT_PROFILE (session.ts:428-450).
Allowed locale values mirror sections.tsx option lists; enforced in Pydantic.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.users import _utcnow
from app.models.catalog import SUBJECT_CODES  # noqa: F401 (re-export for routers)
from app.models.users import JsonType

WEEKLY_GOALS = ("3 days", "5 days", "7 days")
DIFFICULTIES = ("easy", "medium", "hard")
DEPTHS = ("auto", "ask", "deep")
VERBOSITIES = ("concise", "balanced", "thorough")
CITATIONS = ("always", "on request")
RETENTIONS = ("forever", "1 year", "30 days", "session")
SEMESTERS = ("", "1", "2", "3", "4", "5", "6", "7", "8")
BRANCHES = ("", "CSE", "ECE", "EEE", "ME", "CE", "BT", "Other")
CAMPUSES = ("", "RR", "EC")
LANGUAGES = (
    "en-US", "en-GB", "hi", "kn", "ta", "te", "ml", "mr", "bn",
    "es", "fr", "de", "ja", "zh-CN", "pt", "ru", "ar", "ko",
)
REGIONS = (
    "IN", "US", "GB", "DE", "FR", "JP", "CN", "CA", "AU", "AE",
    "SG", "BR", "ES", "IT", "NL", "KR", "ZA", "SA",
)
TIMEZONES = (
    "PT", "MT", "CT", "ET", "AT", "ART", "HST", "AKT", "UTC", "CET",
    "EET", "SAST", "MSK", "GST", "IST", "NPT", "BDT", "ICT", "CST",
    "JST", "AET", "NZT",
)


class Profile(Base):
    __tablename__ = "profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    display_name: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    email: Mapped[str] = mapped_column(String(254), default="", nullable=False)
    institution: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    semester: Mapped[str] = mapped_column(String(8), default="", nullable=False)
    branch: Mapped[str] = mapped_column(String(16), default="", nullable=False)
    subjects: Mapped[list] = mapped_column(JsonType, default=list, nullable=False)
    exam_month: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    weekly_goal: Mapped[str] = mapped_column(String(16), default="5 days", nullable=False)
    difficulty: Mapped[str] = mapped_column(String(16), default="medium", nullable=False)
    depth: Mapped[str] = mapped_column(String(16), default="auto", nullable=False)
    verbosity: Mapped[str] = mapped_column(String(16), default="balanced", nullable=False)
    proactive_quiz: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    follow_ups: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    citations: Mapped[str] = mapped_column(String(16), default="on request", nullable=False)
    retention: Mapped[str] = mapped_column(String(16), default="forever", nullable=False)
    language: Mapped[str] = mapped_column(String(16), default="en-US", nullable=False)
    region: Mapped[str] = mapped_column(String(16), default="IN", nullable=False)
    campus: Mapped[str] = mapped_column(String(8), default="", nullable=False)
    onboarding_done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    timezone: Mapped[str] = mapped_column(String(16), default="IST", nullable=False)
    shortcut_new_chat: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    shortcut_cancel: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    shortcut_focus: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )
    # Back-reference for User.profile delete cascade (see models/users.py).
    user: Mapped["User"] = relationship("User", back_populates="profile")
