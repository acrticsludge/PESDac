"""Chat + demo-state schemas."""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, field_validator

from app import security
from app.models.catalog import SUBJECT_CODES
from app.models.chats import DEMO_LABELS

# Serialized-content cap (spec §3.2): appends whose JSON-serialized
# `content` exceeds this are rejected with 422, never 500.
MESSAGE_CONTENT_MAX_BYTES = 100 * 1024


class ChatCreate(BaseModel):
    subject: str
    title: str

    @field_validator("subject")
    @classmethod
    def _subject(cls, v: str) -> str:
        if v not in SUBJECT_CODES:
            raise ValueError("Unknown subject.")
        return v

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        clean = security.clean_title(v)
        if clean is None:
            raise ValueError("Title must be 1–34 characters.")
        return clean


class ChatPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    isPinned: bool | None = None
    isArchived: bool | None = None

    @field_validator("title")
    @classmethod
    def _title(cls, v: str | None) -> str | None:
        if v is None:
            return v
        clean = security.clean_title(v)
        if clean is None:
            raise ValueError("Title must be 1–34 characters.")
        return clean


class ChatOut(BaseModel):
    code: str
    subject: str
    title: str
    isPinned: bool
    isArchived: bool
    createdAt: str
    updatedAt: str


class ChatListOut(BaseModel):
    data: list[ChatOut]
    pagination: "Pagination"


class Pagination(BaseModel):
    """Pagination envelope for list endpoints. `{limit, offset, total}`
    is the wire format — see docs/api-design-audit.md §2.5 for why
    we don't follow the skill's `{page, pageSize, totalItems, totalPages}`
    shape (the frontend already consumes the current shape; the
    One-Version Rule says don't break it without value)."""

    limit: int
    offset: int
    total: int


class MessageCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant", "system"]
    content: dict[str, Any]

    @field_validator("content")
    @classmethod
    def _content_size(cls, v: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(v).encode("utf-8")) > MESSAGE_CONTENT_MAX_BYTES:
            raise ValueError("Content exceeds 100KB.")
        return v


class MessageOut(BaseModel):
    id: str
    seq: int
    role: str
    content: dict[str, Any]
    createdAt: str


class MessageListOut(BaseModel):
    data: list[MessageOut]
    pagination: "Pagination"


class DemoPut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    displayTitle: str | None = None
    isHidden: bool | None = None
    isPinned: bool | None = None

    @field_validator("displayTitle")
    @classmethod
    def _dt(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if v == "":
            return None
        if len(v) > 34:
            raise ValueError("Display title must be at most 34 characters.")
        return v


class DemoOut(BaseModel):
    demoLabel: str
    displayTitle: str | None
    isHidden: bool
    isPinned: bool


def check_demo_label(label: str) -> str:
    if label not in DEMO_LABELS:
        raise ValueError("Unknown demo conversation.")
    return label
