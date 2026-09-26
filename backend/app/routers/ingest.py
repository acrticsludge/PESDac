"""Curator ingest (spec §6.1): manifest POST + validate POST.

Only write path (no upload endpoint, no scheduler — D10). Curator
triggers ingestion explicitly via manifest POST.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app import cache, rate_limit
from app.db import get_db
from app.deps import check_mutation_origin, get_current_user
from app.models.retrieval import IngestEvent, RetrievalChunk, RetrievalSource
from app.models.users import User
from app.retrieval import chunkstore
from app.retrieval.embeddings import (
    EmbedMisconfigured,
    EmbedUnreachable,
    embed_texts,
    select_provider,
)
from app.retrieval.manifest import ManifestError, parse_manifest
from app.schemas.common import error_body
from app.schemas.retrieval import ManifestIn

router = APIRouter(prefix="/ingest", tags=["ingest"])

logger = logging.getLogger("pesdac")


def _is_curator(user: User) -> bool:
    raw = os.environ.get("CURATOR_AUTH_IDS", "")
    allow = {entry.strip().lower() for entry in raw.split(",") if entry.strip()}
    if not allow:
        return False
    if (user.auth_user_id or "").strip().lower() in allow:
        return True
    return (user.email or "").strip().lower() in allow


def _active_provider():
    return select_provider()


def _r2_base() -> str:
    return os.environ.get("R2_PUBLIC_BASE", "")


def _embed_text(item: dict) -> str:
    parts = [
        item.get("text") or "",
        item.get("caption") or "",
        item.get("latex") or "",
        item.get("table_md") or "",
        " ".join(item.get("concepts") or []),
    ]
    return " ".join(p for p in (s.strip() for s in parts) if p)


def _neurons_estimate(items: list[dict]) -> int:
    total = 0
    for item in items:
        total += max(1, len(_embed_text(item)) // 4)
    return total


def _client_key(request: Request, body_key: str | None) -> str | None:
    header_key = request.headers.get("x-client-ingest-key") or request.headers.get(
        "clientingestkey"
    )
    raw = header_key if header_key is not None else body_key
    if raw is None:
        return None
    clean = raw.strip()
    if clean == "":
        return None
    if len(clean) > 64:
        raise ManifestError("clientIngestKey must be at most 64 characters.")
    return clean


@router.post("/manifest", status_code=201)
def post_manifest(
    body: ManifestIn,
    request: Request,
    result: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("ingest-manifest", request, 10, 300):
        return limited
    if not _is_curator(result):
        return JSONResponse(
            status_code=403,
            content=error_body(
                "CURATOR_ONLY", "Only curators can add course material."
            ),
        )
    try:
        key = _client_key(request, body.clientIngestKey)
    except ManifestError as exc:
        return JSONResponse(
            status_code=422, content=error_body("VALIDATION_ERROR", str(exc))
        )
    if key is not None:
        existing = (
            db.query(IngestEvent)
            .filter(IngestEvent.client_ingest_key == key)
            .one_or_none()
        )
        if existing is not None:
            return JSONResponse(
                status_code=200,
                content={
                    "source_id": str(existing.source_id),
                    "chunk_count": existing.chunk_count,
                },
            )
    raw = body.model_dump()
    try:
        parsed = parse_manifest(raw, _r2_base())
    except ManifestError as exc:
        return JSONResponse(
            status_code=422, content=error_body("VALIDATION_ERROR", str(exc))
        )
    # Embed-before-txn: missing vectors resolve before any DB write, so
    # a slow provider never pins pool slots inside the upsert txn, and
    # a provider failure persists nothing (all-or-nothing per request).
    provider = _active_provider()
    try:
        missing_texts = [
            _embed_text(c) for c in parsed["chunks"] if c.get("embedding") is None
        ]
        fresh_vecs = embed_texts(provider, missing_texts) if missing_texts else []
    except EmbedMisconfigured:
        return JSONResponse(
            status_code=503,
            content=error_body(
                "EMBED_MISCONFIGURED",
                "Embedding isn't configured on this server.",
            ),
        )
    except EmbedUnreachable:
        return JSONResponse(
            status_code=502,
            content=error_body(
                "EMBED_UNREACHABLE",
                "Couldn't reach the embedding service. Nothing was saved. Try again.",
            ),
        )
    fresh_iter = iter(fresh_vecs)
    items: list[dict] = []
    for chunk_dict in parsed["chunks"]:
        emb = chunk_dict.get("embedding")
        if emb is None:
            emb = next(fresh_iter)
        items.append({**chunk_dict, "embedding": emb})
    src_info = parsed["source"]
    manifest_sha = hashlib.sha256(
        json.dumps(raw, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    provider_name = getattr(provider, "name", "")
    provider_model = getattr(provider, "model", "")
    now = datetime.now(timezone.utc)
    source = (
        db.query(RetrievalSource)
        .filter(
            RetrievalSource.subject == src_info["subject"],
            RetrievalSource.unit == src_info["unit"],
            RetrievalSource.kind == src_info["kind"],
            RetrievalSource.r2_key == src_info["r2_key"],
        )
        .one_or_none()
    )
    if source is None:
        source = RetrievalSource(
            subject=src_info["subject"],
            unit=src_info["unit"],
            kind=src_info["kind"],
            title=src_info["title"],
            r2_key=src_info["r2_key"],
            public_url=src_info["public_url"],
            page_count=src_info["page_count"],
            version=1,
        )
        db.add(source)
        db.flush()
    else:
        db.query(RetrievalChunk).filter(
            RetrievalChunk.source_id == source.id
        ).delete()
        source.title = src_info["title"]
        source.public_url = src_info["public_url"]
        source.page_count = src_info["page_count"]
        source.updated_at = now
        source.version = (source.version or 1) + 1
        db.flush()
    stamped = [
        {
            **item,
            "embed_provider": provider_name,
            "embed_model": provider_model,
        }
        for item in items
    ]
    chunkstore.store_chunks(db, source, stamped)
    event = IngestEvent(
        curator_user_id=result.id,
        source_id=source.id,
        client_ingest_key=key,
        chunk_count=len(stamped),
        manifest_sha256=manifest_sha,
        embed_provider=provider_name,
        embed_model=provider_model,
        neurons_estimate=_neurons_estimate(stamped),
    )
    db.add(event)
    # Opportunistic GC: each ingest deletes keys older than 30 d, no
    # scheduler needed; replays past GC re-execute as new versions.
    db.query(IngestEvent).filter(
        IngestEvent.created_at < now - timedelta(days=30)
    ).delete()
    db.commit()
    db.refresh(source)
    cache.invalidate_prefix(cache.retrieval_prefix(src_info["subject"]))
    return JSONResponse(
        status_code=201,
        content={"source_id": str(source.id), "chunk_count": len(stamped)},
    )


@router.post("/validate")
def post_validate(
    body: ManifestIn,
    request: Request,
    result: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Curator dry-run (spec §6.1b): identical validators, zero writes."""
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("ingest-manifest", request, 10, 300):
        return limited
    if not _is_curator(result):
        return JSONResponse(
            status_code=403,
            content=error_body(
                "CURATOR_ONLY", "Only curators can add course material."
            ),
        )
    try:
        parsed = parse_manifest(body.model_dump(), _r2_base())
    except ManifestError as exc:
        return JSONResponse(
            status_code=422, content=error_body("VALIDATION_ERROR", str(exc))
        )
    return {
        "ok": True,
        "chunk_count": parsed["chunk_count"],
        "warnings": parsed["warnings"],
    }
