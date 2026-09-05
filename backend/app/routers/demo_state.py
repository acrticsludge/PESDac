"""Demo overrides (arch §7.4). Registry stays in the frontend; only per-user
overrides persist. Unknown labels → 422."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import check_mutation_origin, get_current_user
from app.models.chats import DEMO_LABELS, DemoState
from app.schemas.chats import DemoOut, DemoPut
from app.schemas.common import error_body

router = APIRouter(prefix="/demo-state", tags=["demo-state"])


def _out(row: DemoState) -> dict:
    return {
        "demoLabel": row.demo_label, "displayTitle": row.display_title,
        "isHidden": row.is_hidden, "isPinned": row.is_pinned,
    }


@router.get("")
def list_demo(result=Depends(get_current_user), db: Session = Depends(get_db)):
    if isinstance(result, JSONResponse):
        return result
    rows = db.scalars(select(DemoState).where(DemoState.user_id == result.id)).all()
    return {"overrides": [_out(r) for r in rows]}


@router.put("/{label}")
def put_demo(label: str, body: DemoPut, request: Request, result=Depends(get_current_user), db: Session = Depends(get_db)):
    if isinstance(result, JSONResponse):
        return result
    if denied := check_mutation_origin(request):
        return denied
    if label not in DEMO_LABELS:
        return JSONResponse(status_code=422, content=error_body("VALIDATION_ERROR", "Unknown demo conversation."))
    row = db.get(DemoState, (result.id, label))
    if row is None:
        row = DemoState(user_id=result.id, demo_label=label)
        db.add(row)
    data = body.model_dump(exclude_unset=True)
    if "displayTitle" in data:
        row.display_title = data["displayTitle"]
    if data.get("isHidden") is not None:
        row.is_hidden = bool(data["isHidden"])
    if data.get("isPinned") is not None:
        row.is_pinned = bool(data["isPinned"])
    db.commit()
    db.refresh(row)
    return _out(row)
