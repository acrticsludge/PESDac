"""Subject catalog — the 5 seeded codes (frontend/src/lib/chat.ts SUBJECTS)."""

from __future__ import annotations

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Subject(Base):
    __tablename__ = "subjects"

    code: Mapped[str] = mapped_column(String(16), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False)


SUBJECT_SEEDS: tuple[tuple[str, str], ...] = (
    ("CN", "Computer Networks"),
    ("OS", "Operating Systems"),
    ("DLCD", "Digital Logic"),
    ("DSA", "Data Structures"),
    ("Math", "Mathematics"),
)

SUBJECT_CODES = frozenset(code for code, _ in SUBJECT_SEEDS)
