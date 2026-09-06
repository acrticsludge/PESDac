"""Single error envelope for every error response (arch §9)."""

from __future__ import annotations

from typing import Any


def error_body(code: str, message: str, details: Any | None = None) -> dict:
    body: dict = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return body


INTERNAL_ERROR = error_body("INTERNAL", "Something went wrong.")
UNAUTHORIZED = error_body("UNAUTHORIZED", "Authentication required.")
