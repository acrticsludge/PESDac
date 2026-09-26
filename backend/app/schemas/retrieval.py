"""Retrieval schemas (spec §6): manifest/search/health/validate.

All models use `extra="forbid"` — unknown fields (notably any
user-image bytes) are rejected, never stored.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


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
