"""Bundle fusion P1 (spec §6.2 steps 6-7): RRF + MMR in pure Python.

No cross-encoder/LLM rerank (D5). `build_bundle` is shaped so per-pair
judgment packs plug in later with fail-open to RRF and zero route
changes.
"""

from __future__ import annotations

import os

from sqlalchemy.orm import Session

from app.models.retrieval import RetrievalChunk, RetrievalSource

DEFAULT_RRF_K = 60
DEFAULT_MAX_CHARS = 24000


def rrf_k() -> int:
    try:
        return max(1, int(os.environ.get("RRF_K", str(DEFAULT_RRF_K))))
    except ValueError:
        return DEFAULT_RRF_K


def rrf_fuse(
    ann_ids: list, fts_ids: list, k: int | None = None
) -> dict:
    """Fuse two legs: score += 1/(k+rank) per leg (1-indexed ranks)."""
    kk = k if k is not None else rrf_k()
    scores: dict = {}
    for rank, cid in enumerate(ann_ids, start=1):
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (kk + rank)
    for rank, cid in enumerate(fts_ids, start=1):
        scores[cid] = scores.get(cid, 0.0) + 1.0 / (kk + rank)
    return scores


def _chunk_chars(chunk: RetrievalChunk) -> int:
    return len(
        (chunk.text or "")
        + (chunk.latex or "")
        + (chunk.table_md or "")
        + (chunk.caption or "")
    )


def shape_chunk(chunk: RetrievalChunk, source: RetrievalSource, score: float) -> dict:
    video = None
    if chunk.kind == "transcript":
        video = {
            "url": source.public_url,
            "start": chunk.video_start,
            "end": chunk.video_end,
        }
    return {
        "chunk_id": str(chunk.id),
        "kind": chunk.kind,
        "page": chunk.page,
        "bbox": chunk.bbox,
        "text": chunk.text,
        "latex": chunk.latex,
        "table_md": chunk.table_md,
        "caption": chunk.caption,
        "concepts": chunk.concepts or [],
        "thumb_url": chunk.thumb_url,
        "page_url": chunk.page_url,
        "video": video,
        "score": score,
    }


def build_bundle(
    db: Session,
    scores: dict,
    topK: int = 10,
    max_chars: int = DEFAULT_MAX_CHARS,
    judgments: dict | None = None,
) -> list[dict]:
    """Rank → MMR-thin → topK → char cap (whole-chunk drops only)."""
    if not scores:
        return []
    try:
        boosts = dict(judgments) if judgments else {}
    except Exception:
        boosts = {}
    fused = {
        cid: float(score) + float(boosts.get(cid, 0.0) or 0.0)
        for cid, score in scores.items()
    }
    ranked = sorted(fused.items(), key=lambda kv: kv[1], reverse=True)
    ids = [cid for cid, _ in ranked]
    chunks: dict = {}
    sources: dict = {}
    if ids:
        rows = (
            db.query(RetrievalChunk, RetrievalSource)
            .join(RetrievalSource, RetrievalChunk.source_id == RetrievalSource.id)
            .filter(RetrievalChunk.id.in_(ids))
            .all()
        )
        for chunk, source in rows:
            chunks[chunk.id] = chunk
            sources[chunk.id] = source
    # MMR-thin over (source, page, kind): first pass takes at most one
    # per triple so one page can't fill the bundle with 10 equations;
    # second pass fills remaining slots in rank order.
    ordered: list = []
    seen: set = set()
    for cid, _ in ranked:
        chunk = chunks.get(cid)
        if chunk is None:
            continue
        key = (chunk.source_id, chunk.page, chunk.kind)
        if key not in seen:
            seen.add(key)
            ordered.append(cid)
        if len(ordered) >= topK:
            break
    if len(ordered) < topK:
        picked = set(ordered)
        for cid, _ in ranked:
            if cid in picked or cid not in chunks:
                continue
            ordered.append(cid)
            if len(ordered) >= topK:
                break
    # Bundle cap: drop lowest-ranked whole chunks first, never truncate.
    shaped: list[dict] = []
    total = 0
    for cid in ordered:
        chunk = chunks[cid]
        cost = _chunk_chars(chunk)
        if shaped and total + cost > max_chars:
            continue
        shaped.append(shape_chunk(chunk, sources[cid], fused[cid]))
        total += cost
    return shaped
