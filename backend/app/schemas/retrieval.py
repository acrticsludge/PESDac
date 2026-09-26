"""Retrieval schemas (spec §6): manifest/search/health/validate.

All models use `extra="forbid"` — unknown fields (notably any
user-image bytes) are rejected, never stored.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.catalog import SUBJECT_CODES


class SourceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str
    title: str
    r2_key: str
    public_url: str | None = None
    page_count: int = 0
    subject: str | None = None
    unit: str | None = None


class ChunkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str
    page: int | None = None
    bbox: dict | None = None
    text: str | None = None
    latex: str | None = None
    table_md: str | None = None
    caption: str | None = None
    concepts: list[str] | None = None
    video_start: float | None = None
    video_end: float | None = None
    thumb_url: str | None = None
    page_url: str | None = None
    embedding: list[float] | None = None


class ManifestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    manifest_version: int = 1
    subject: str
    unit: str
    source: SourceIn
    chunks: list[ChunkIn]
    clientIngestKey: str | None = None


SEARCH_SCOPES = frozenset({"slides", "textbook", "lectures"})


class SearchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str
    subject: str
    scope: list[str] | None = None
    topK: int = 10

    @field_validator("query")
    @classmethod
    def _query(cls, v: str) -> str:
        clean = " ".join((v or "").split())
        if not (1 <= len(clean) <= 2000):
            raise ValueError("Query must be 1–2000 characters.")
        return v

    @field_validator("subject")
    @classmethod
    def _subject(cls, v: str) -> str:
        if v not in SUBJECT_CODES:
            raise ValueError("Unknown subject.")
        return v

    @field_validator("scope")
    @classmethod
    def _scope(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        for entry in v:
            if entry not in SEARCH_SCOPES:
                raise ValueError("Unknown scope.")
        return v

    @field_validator("topK")
    @classmethod
    def _topk(cls, v: int) -> int:
        if not (1 <= v <= 20):
            raise ValueError("topK must be 1–20.")
        return v
