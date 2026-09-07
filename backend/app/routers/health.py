"""Liveness + readiness (arch §10). No auth, no secrets."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas.common import error_body

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"ok": True}


@router.get("/ready")
def ready(db: Session = Depends(get_db)) -> dict:
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        # Every 4xx/5xx in the app uses the {error: {code, message}}
        # envelope (see app/schemas/common.py). /ready is the only
        # route that didn't, which meant consumers couldn't tell
        # "no DB" from "endpoint gone" without reading the body
        # shape. Use the same envelope here too.
        return JSONResponse(  # type: ignore[return-value]
            status_code=503,
            content=error_body("UNHEALTHY", "Database unavailable."),
        )
    return {"ok": True}
