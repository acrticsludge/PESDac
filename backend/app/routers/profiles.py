"""Profiles: auto-create blank row on first read; PATCH merges; full row back."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app import rate_limit
from app.db import get_db
from app.deps import (
    check_mutation_origin,
    get_current_user,
    get_or_create_profile,
)
from app.models.users import User
from app.schemas.profiles import PROFILE_FIELDS, ProfilePatch, profile_to_out

router = APIRouter(prefix="/profiles", tags=["profiles"])


def _get_or_create(db: Session, user):
    return get_or_create_profile(db, user)


@router.get("/me")
def get_me(result: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = _get_or_create(db, result)
    return profile_to_out(profile)


@router.patch("/me")
def patch_me(body: ProfilePatch, request: Request, result: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("profiles-patch", request, 60, 60):
        return limited
    profile = _get_or_create(db, result)
    data = body.model_dump(exclude_unset=True)
    for field, api in PROFILE_FIELDS:
        if api in data and data[api] is not None:
            setattr(profile, field, data[api])
    db.commit()
    db.refresh(profile)
    return profile_to_out(profile)
