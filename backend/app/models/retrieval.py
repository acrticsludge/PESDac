"""Retrieval P1 models — portable columns only (spec §4.1).

SQLite tests build schema via `create_all`, never migrations. The
`vector(1024)` column, HNSW index, and `tsv` generated column live in
migration `0012_retrieval` behind a Postgres-dialect guard. Prod reads
`embedding_v`, tests read `embedding` (JSON list[float], 1024d).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.users import JsonType, _utcnow

SOURCE_KINDS = frozenset({"slides", "notes", "textbook", "video", "diagram-set"})
CHUNK_KINDS = frozenset({"text", "equation", "table", "diagram", "page", "transcript"})


class RetrievalSource(Base):
    __tablename__ = "retrieval_sources"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    subject: Mapped[str] = mapped_column(
        ForeignKey("subjects.code"), nullable=False
    )
    unit: Mapped[str] = mapped_column(String(32), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    r2_key: Mapped[str] = mapped_column(Text, nullable=False)
    public_url: Mapped[str] = mapped_column(Text, nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "subject", "unit", "kind", "r2_key",
            name="uq_retrieval_sources_natural",
        ),
        Index("ix_retrieval_sources_subject_unit", "subject", "unit"),
    )

    chunks: Mapped[list["RetrievalChunk"]] = relationship(
        "RetrievalChunk", back_populates="source", cascade="all, delete-orphan"
    )


class RetrievalChunk(Base):
    __tablename__ = "retrieval_chunks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("retrieval_sources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bbox: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    latex: Mapped[str | None] = mapped_column(Text, nullable=True)
    table_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    concepts: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    video_start: Mapped[float | None] = mapped_column(Float, nullable=True)
    video_end: Mapped[float | None] = mapped_column(Float, nullable=True)
    thumb_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding: Mapped[list] = mapped_column(JsonType, nullable=False, default=list)
    embed_provider: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    embed_model: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    __table_args__ = (
        Index("ix_retrieval_chunks_source", "source_id"),
    )

    source: Mapped["RetrievalSource"] = relationship(
        "RetrievalSource", back_populates="chunks"
    )


class IngestEvent(Base):
    __tablename__ = "ingest_events"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    curator_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("retrieval_sources.id", ondelete="SET NULL"), nullable=True
    )
    client_ingest_key: Mapped[str | None] = mapped_column(
        String(64), nullable=True, default=None
    )
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    manifest_sha256: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    embed_provider: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    embed_model: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    neurons_estimate: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "client_ingest_key", name="uq_ingest_events_client_key"
        ),
        Index("ix_ingest_events_source", "source_id"),
        Index("ix_ingest_events_curator", "curator_user_id"),
    )
