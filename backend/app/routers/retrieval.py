"""Evidence search + health (spec §6.2/§6.3).

Gate → cache → embed → space-check → ChunkStore → Bundle.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import cache, rate_limit, timing
from app.db import get_db
from app.deps import check_mutation_origin, get_current_user
from app.models.retrieval import IngestEvent, RetrievalChunk, RetrievalSource
from app.models.users import User
from app.retrieval import chunkstore
from app.retrieval import rrf as rrf_mod
from app.retrieval.embeddings import (
    EMBED_DIMS,
    EmbedMisconfigured,
    EmbedUnreachable,
    embed_texts,
    select_provider,
)
from app.schemas.common import error_body
from app.schemas.retrieval import SEARCH_SCOPES, SearchIn

router = APIRouter(prefix="/retrieval", tags=["retrieval"])

logger = logging.getLogger("pesdac")


def _active_provider():
    return select_provider()


def _max_chars() -> int:
    try:
        return max(1024, int(os.environ.get("RETRIEVAL_MAX_CHARS", "24000")))
    except ValueError:
        return 24000


def _is_pg(db: Session) -> bool:
    try:
        return getattr(getattr(db, "bind", None), "dialect", None) is not None and getattr(
            db.bind.dialect, "name", ""
        ) == "postgresql"
    except Exception:
        return False


def _pg_ids(db: Session, stmt, params: dict) -> list:
    rows = db.execute(stmt, params).all()
    return [row[0] for row in rows]


@router.post("/search")
def post_search(
    body: SearchIn,
    request: Request,
    result: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if denied := check_mutation_origin(request):
        return denied
    if limited := rate_limit.check("retrieval-search", request, 60, 60):
        return limited
    normalized = " ".join(body.query.split())
    scope_list = sorted(body.scope) if body.scope else sorted(SEARCH_SCOPES)
    scope_set = set(scope_list)
    topK = body.topK
    key = cache.retrieval_result_key(body.subject, scope_list, topK, normalized)
    outcome, cached = cache.get_json(key)
    if outcome == cache.HIT and isinstance(cached, dict):
        timing.note_cache_outcome(cache.HIT)
        return cached
    first = outcome
    try:
        provider = _active_provider()
    except EmbedMisconfigured:
        timing.note_cache_outcome(cache.OFF if first == cache.OFF else cache.MISS)
        return JSONResponse(
            status_code=503,
            content=error_body(
                "EMBED_MISCONFIGURED", "Search isn't configured on this server."
            ),
        )
    try:
        vecs = embed_texts(provider, [normalized])
    except EmbedMisconfigured:
        timing.note_cache_outcome(cache.OFF if first == cache.OFF else cache.MISS)
        return JSONResponse(
            status_code=503,
            content=error_body(
                "EMBED_MISCONFIGURED", "Search isn't configured on this server."
            ),
        )
    except EmbedUnreachable:
        timing.note_cache_outcome(cache.OFF if first == cache.OFF else cache.MISS)
        return JSONResponse(
            status_code=502,
            content=error_body(
                "EMBED_UNREACHABLE",
                "Search is temporarily unavailable. Try again in a bit.",
            ),
        )
    qvec = vecs[0]
    space_key = cache.retrieval_space_key(body.subject, scope_list)
    space_outcome, space_cached = cache.get_json(space_key)
    if space_outcome == cache.HIT and isinstance(space_cached, list):
        stamps = [tuple(s) for s in space_cached]
    elif _is_pg(db):
        # Genuine pre-ANN DISTINCT in SQL (never a post-fetch filter);
        # the SQLite path scans the scoped base query instead.
        rows = db.execute(
            chunkstore.space_statement(body.subject, scope_set),
            {"subject": body.subject},
        ).all()
        stamps = [(r[0], r[1]) for r in rows]
        cache.set_json(space_key, [list(s) for s in stamps], cache.TTL_RETRIEVAL_SPACE)
    else:
        stamps = chunkstore.provider_slice(db, body.subject, scope_set)
        cache.set_json(space_key, [list(s) for s in stamps], cache.TTL_RETRIEVAL_SPACE)
    active = (getattr(provider, "name", ""), getattr(provider, "model", ""))
    if any(tuple(s) != active for s in stamps):
        timing.note_cache_outcome(cache.OFF if first == cache.OFF else cache.MISS)
        return JSONResponse(
            status_code=503,
            content=error_body(
                "EMBED_SPACE_MISMATCH",
                "Search index needs a refresh. Let your instructor know.",
            ),
        )
    if _is_pg(db):
        vec_literal = "[" + ",".join(repr(float(v)) for v in qvec) + "]"
        ann_ids = _pg_ids(
            db,
            chunkstore.ann_statement(body.subject, scope_set, qvec),
            {"q": vec_literal, "subject": body.subject, "limit": 30},
        )
        fts_ids = _pg_ids(
            db,
            chunkstore.fts_statement(body.subject, scope_set, normalized),
            {"q": normalized, "subject": body.subject, "limit": 30},
        )
    else:
        ann_ids = [c.id for c in chunkstore.ann_search(db, body.subject, scope_set, qvec)]
        fts_ids = [
            c.id
            for c in chunkstore.fts_search(db, body.subject, scope_set, normalized)
        ]
    scores = rrf_mod.rrf_fuse(ann_ids, fts_ids)
    bundle = rrf_mod.build_bundle(db, scores, topK=topK, max_chars=_max_chars())
    response = {
        "data": bundle,
        "pagination": {"limit": topK, "offset": 0, "total": len(bundle)},
    }
    stored = cache.set_json(key, response, cache.TTL_RETRIEVAL_RESULT)
    final = (
        cache.MISS
        if (first == cache.MISS and stored == "STORED")
        else (
            cache.SKIP
            if stored == cache.SKIP
            else cache.OFF
            if first == cache.OFF or stored == cache.OFF
            else cache.MISS
        )
    )
    timing.note_cache_outcome(final)
    return response


@router.get("/health")
def get_health(db: Session = Depends(get_db)):
    key = cache.retrieval_health_key()
    outcome, cached = cache.get_json(key)
    if outcome == cache.HIT and isinstance(cached, dict):
        timing.note_cache_outcome(cache.HIT)
        return cached
    try:
        provider = _active_provider()
        provider_name = getattr(provider, "name", "")
        ok = True
    except EmbedMisconfigured:
        provider_name = (os.environ.get("RETRIEVAL_EMBED_PROVIDER") or "workers-ai").strip()
        ok = False
    sources = db.query(RetrievalSource).count()
    chunks = db.query(RetrievalChunk).count()
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    neurons = (
        db.query(func.coalesce(func.sum(IngestEvent.neurons_estimate), 0))
        .filter(IngestEvent.created_at >= since)
        .scalar()
    )
    body = {
        "ok": ok,
        "provider": provider_name,
        "dims": EMBED_DIMS,
        "sources": sources,
        "chunks": chunks,
        "neurons_24h_estimate": int(neurons or 0),
    }
    cache.set_json(key, body, cache.TTL_RETRIEVAL_HEALTH)
    timing.note_cache_outcome(cache.MISS)
    return body
