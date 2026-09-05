"""Profiles: auto-create blank row on first read; PATCH merges; full row back."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import check_mutation_origin, get_current_user
from app.models.profiles import Profile
from app.schemas.profiles import PROFILE_FIELDS, ProfilePatch, profile_to_out

router = APIRouter(prefix="/profiles", tags=["profiles"])


def _get_or_create(db: Session, user) -> Profile:
    profile = db.get(Profile, user.id)
    if profile is None:
        profile = Profile(user_id=user.id, display_name=user.display_name, email=user.email)
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.get("/me")
def get_me(result=Depends(get_current_user), db: Session = Depends(get_db)):
    if isinstance(result, JSONResponse):
        return result
    profile = _get_or_create(db, result)
    return profile_to_out(profile)


@router.patch("/me")
def patch_me(body: ProfilePatch, request: Request, result=Depends(get_current_user), db: Session = Depends(get_db)):
    if isinstance(result, JSONResponse):
        return result
    if denied := check_mutation_origin(request):
        return denied
    profile = _get_or_create(db, result)
    data = body.model_dump(exclude_unset=True)
    for field, api in PROFILE_FIELDS:
        if api in data and data[api] is not None:
            setattr(profile, field, data[api])
    db.commit()
    db.refresh(profile)
    return profile_to_out(profile)
