"""LLM BYOK: server-side OpenRouter keys (spec llm-byok-settings §4.2).

`GET /llm/status` (cheap indexed read, uncached by design) tells the
UI whether a working key exists. `PUT /llm/key` validates the key
against OpenRouter *before* persisting (Fernet-encrypted, hint-only
responses). `DELETE /llm/key` is idempotent (T22).

The raw key never appears in a response or a log line — only the
last-4 hint, minted at save time.
"""

from __future__ import annotations

import logging
from datetime import timezone

import httpx
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config, llm_crypto, rate_limit
from app.db import get_db
from app.deps import check_mutation_origin, get_current_user
from app.models.llm import LlmCredential
from app.models.users import User
from app.schemas.common import error_body
from app.schemas.llm import LlmKeyPut

router = APIRouter(prefix="/llm", tags=["llm"])

logger = logging.getLogger("pesdac")

OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/auth/key"
DEFAULT_MODEL = "openai/gpt-4o-mini"


def _validate_openrouter_key(api_key: str) -> str:
    """Validate a candidate key. Returns "valid" | "invalid" | "unreachable".

    Probed 2026-09-14: `/models` is public (200 even for bogus keys),
    so validation uses `/auth/key` — 200 valid, 401/403 invalid,
    anything else (timeout/5xx/network) unreachable. No retries: a
    slow provider must fail fast to 502, never hang the save.
    Separated for testability (tests stub this, never the network).
    """
    try:
        with httpx.Client(timeout=httpx.Timeout(connect=5.0, read=5.0,
                                                write=5.0, pool=5.0)) as client:
            resp = client.get(OPENROUTER_KEY_URL,
                              headers={"Authorization": f"Bearer {api_key}"})
    except Exception as exc:
        logger.warning("llm_validate_unreachable category=%s",
                       type(exc).__name__)
        return "unreachable"
    if resp.status_code == 200:
        return "valid"
    if resp.status_code in (401, 403):
        logger.warning("llm_validate_rejected status=%d", resp.status_code)
        return "invalid"
    logger.warning("llm_validate_unreachable status=%d", resp.status_code)
    return "unreachable"


def _iso(dt) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _status_for(user: User, db: Session) -> dict:
    row = db.scalar(select(LlmCredential).where(
        LlmCredential.user_id == user.id,
        LlmCredential.provider == "openrouter",
    ))
    if row is None:
        return {"configured": False, "provider": None, "keyHint": None,
                "model": None, "validatedAt": None}
    try:
        llm_crypto.decrypt(row.key_encrypted)
    except llm_crypto.LlmCryptoError:
        # Rotation orphan / wrong env key: honest "re-enter your key",
        # never a crash, never the exception text.
        return {"configured": False, "provider": row.provider,
                "keyHint": None, "model": None, "validatedAt": None}
    return {"configured": True, "provider": row.provider,
            "keyHint": row.key_hint, "model": row.model,
            "validatedAt": _iso(row.validated_at)}


@router.get("/status")
def get_status(result: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    return _status_for(result, db)


@router.put("/key")
def put_key(body: LlmKeyPut, request: Request,
            result: User = Depends(get_current_user),
            db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    # Strict bucket: each attempt burns an outbound provider call.
    if limited := rate_limit.check("llm-key-save", request, 10, 300):
        return limited
    if not (config.LLM_KEY_ENCRYPTION_KEY or "").strip():
        return JSONResponse(
            status_code=503,
            content=error_body("LLM_CRYPTO_UNAVAILABLE",
                               "Key storage isn't configured on this server."),
        )
    verdict = _validate_openrouter_key(body.apiKey)
    if verdict == "invalid":
        return JSONResponse(
            status_code=400,
            content=error_body("LLM_KEY_INVALID",
                               "That key was rejected by OpenRouter."),
        )
    if verdict != "valid":
        return JSONResponse(
            status_code=502,
            content=error_body("LLM_UNREACHABLE",
                               "Couldn't reach OpenRouter. Nothing was saved."),
        )
    try:
        token = llm_crypto.encrypt(body.apiKey)
    except llm_crypto.LlmCryptoError:
        return JSONResponse(
            status_code=503,
            content=error_body("LLM_CRYPTO_UNAVAILABLE",
                               "Key storage isn't configured on this server."),
        )
    row = db.scalar(select(LlmCredential).where(
        LlmCredential.user_id == result.id,
        LlmCredential.provider == body.provider,
    ))
    if row is None:
        row = LlmCredential(user_id=result.id, provider=body.provider)
        db.add(row)
    row.key_encrypted = token
    row.key_hint = body.apiKey[-4:]
    row.model = body.model
    from datetime import datetime
    row.validated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _status_for(result, db)


@router.delete("/key", status_code=204)
def delete_key(request: Request, result: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("llm-key-delete", request, 60, 60):
        return limited
    # T22 idempotency: missing row is "already deleted" — 204 either way.
    row = db.scalar(select(LlmCredential).where(
        LlmCredential.user_id == result.id,
        LlmCredential.provider == "openrouter",
    ))
    if row is not None:
        db.delete(row)
        db.commit()
    return Response(status_code=204)
