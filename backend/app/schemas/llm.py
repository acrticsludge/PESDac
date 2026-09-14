"""LLM BYOK schemas (spec llm-byok-settings §4.2).

`PUT /llm/key` accepts the raw key once; every response carries only
the status shape — the key is never echoed back.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class LlmKeyPut(BaseModel):
    # v1: OpenRouter only. Stored as a plain string (not enum) so a
    # second provider needs data + validation logic, not DDL.
    provider: Literal["openrouter"] = "openrouter"
    apiKey: str = Field(min_length=1, max_length=500)
    model: str = Field(min_length=1, max_length=120)


class LlmStatusOut(BaseModel):
    configured: bool = False
    provider: str | None = None
    keyHint: str | None = None
    model: str | None = None
    validatedAt: str | None = None
