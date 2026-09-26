"""C2 ChunkStore (spec §6.2 steps 4-5, §4.2 sync invariant).

`store_chunks` / `ann_search` / `fts_search` / `provider_slice` run on
SQLite/tests (brute-force cosine + LIKE). `ann_statement` /
`fts_statement` / `space_statement` build the Postgres legs
(compile-asserted in T4, never executed in suite): ANN `ORDER BY
embedding_v <=> :q` with subject + scope-kind WHERE pushed before
ordering; FTS `tsv @@ plainto_tsquery(:q)` with the same filters;
space check DISTINCT under the same filter.
"""

from __future__ import annotations

import math
from typing import Sequence

from sqlalchemy import select, text
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import TextClause

from app.models.retrieval import RetrievalChunk, RetrievalSource

ANN_FTS_LIMIT = 30

_SLIDE_SOURCE_KINDS = frozenset({"slides"})
_TEXTBOOK_SOURCE_KINDS = frozenset({"textbook", "notes"})
_SLIDE_TEXT_KINDS = frozenset({"page", "diagram", "equation", "table", "text"})


def cosine_sim(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


def persist_chunk_embedding(db: Session, chunk: RetrievalChunk, embedding: Sequence[float]) -> None:
    """Single writer for both embedding columns (spec §4.2 sync invariant).

    Sets the portable `embedding` JSON always. On Postgres, issues the
    `embedding_v` UPDATE in the same txn (raw SQL — the model stays
    portable so SQLite `create_all` never sees a `vector` type). A
    contract test asserts read-back equality of both columns on the
    Postgres path, so a future update path that touches one and not
    the other fails loudly.
    """
    chunk.embedding = [float(v) for v in embedding]
    try:
        dialect = getattr(getattr(db, "bind", None), "dialect", None)
        name = getattr(dialect, "name", "")
    except Exception:
        name = ""
    if name == "postgresql" and chunk.id is not None:
        from sqlalchemy import text as _text

        vec = "[" + ",".join(repr(float(v)) for v in embedding) + "]"
        db.execute(
            _text("UPDATE retrieval_chunks SET embedding_v = :emb WHERE id = :id"),
            {"emb": vec, "id": str(chunk.id)},
        )


def store_chunks(db: Session, source: RetrievalSource, items: list[dict]) -> list[RetrievalChunk]:
    rows: list[RetrievalChunk] = []
    for item in items:
        chunk = RetrievalChunk(
            source_id=source.id,
            kind=item.get("kind", "text"),
            page=item.get("page"),
            bbox=item.get("bbox"),
            text=item.get("text", ""),
            latex=item.get("latex"),
            table_md=item.get("table_md"),
            caption=item.get("caption"),
            concepts=list(item.get("concepts", []) or []),
            video_start=item.get("video_start"),
            video_end=item.get("video_end"),
            thumb_url=item.get("thumb_url"),
            page_url=item.get("page_url"),
            embed_provider=item.get("embed_provider", ""),
            embed_model=item.get("embed_model", ""),
        )
        db.add(chunk)
        db.flush()
        persist_chunk_embedding(db, chunk, item.get("embedding", []))
        rows.append(chunk)
    return rows


def _scope_predicates(subject: str, scope: set[str] | None):
    """Return (source_kind_set | None, chunk_kind_set | None) for scope.

    Scope maps to chunk kinds (spec §6.2): slides→page|diagram|equation|
    table|text from slide sources; textbook→same from textbook sources;
    lectures→transcript. None/empty = all three (no filter).
    """
    if not scope:
        return None, None
    scope = set(scope)
    source_kinds: set[str] = set()
    chunk_kinds: set[str] = set()
    if "slides" in scope:
        source_kinds |= set(_SLIDE_SOURCE_KINDS)
        chunk_kinds |= set(_SLIDE_TEXT_KINDS)
    if "textbook" in scope:
        source_kinds |= set(_TEXTBOOK_SOURCE_KINDS)
        chunk_kinds |= set(_SLIDE_TEXT_KINDS)
    if "lectures" in scope:
        chunk_kinds.add("transcript")
    if "slides" in scope and "textbook" in scope and "lectures" in scope:
        return None, None
    return (source_kinds or None), (chunk_kinds or None)


def _base_query(db: Session, subject: str, scope: set[str] | None):
    source_kinds, chunk_kinds = _scope_predicates(subject, scope)
    stmt = (
        select(RetrievalChunk, RetrievalSource)
        .join(RetrievalSource, RetrievalChunk.source_id == RetrievalSource.id)
        .where(RetrievalSource.subject == subject)
    )
    if source_kinds is not None and "transcript" not in (chunk_kinds or set()):
        stmt = stmt.where(RetrievalSource.kind.in_(sorted(source_kinds)))
        if chunk_kinds:
            stmt = stmt.where(RetrievalChunk.kind.in_(sorted(chunk_kinds)))
    elif source_kinds is not None and chunk_kinds is not None:
        # Mixed slides/textbook + lectures: (slide-source text kinds) OR transcript.
        from sqlalchemy import or_ as _or

        stmt = stmt.where(
            _or(
                (RetrievalSource.kind.in_(sorted(source_kinds)))
                & (RetrievalChunk.kind.in_(sorted(chunk_kinds - {"transcript"}))),
                RetrievalChunk.kind == "transcript",
            )
        )
        return stmt
    if chunk_kinds is not None:
        # Lectures-only or single-scope transcript path.
        if chunk_kinds == {"transcript"}:
            stmt = stmt.where(RetrievalChunk.kind == "transcript")
        elif source_kinds is not None:
            stmt = stmt.where(RetrievalChunk.kind.in_(sorted(chunk_kinds)))
    return stmt


def ann_search(
    db: Session,
    subject: str,
    scope: set[str] | list[str] | None,
    query_emb: Sequence[float],
    limit: int = ANN_FTS_LIMIT,
) -> list[RetrievalChunk]:
    scope_set = set(scope) if scope else None
    rows = db.execute(_base_query(db, subject, scope_set)).all()
    scored: list[tuple[float, RetrievalChunk]] = []
    for chunk, _source in rows:
        emb = chunk.embedding or []
        if not emb or not query_emb:
            continue
        scored.append((cosine_sim(emb, query_emb), chunk))
    scored.sort(key=lambda kv: kv[0], reverse=True)
    return [chunk for _, chunk in scored[:limit]]


def fts_search(
    db: Session,
    subject: str,
    scope: set[str] | list[str] | None,
    query_text: str,
    limit: int = ANN_FTS_LIMIT,
) -> list[RetrievalChunk]:
    needle = (query_text or "").strip().lower()
    if not needle:
        return []
    scope_set = set(scope) if scope else None
    rows = db.execute(_base_query(db, subject, scope_set)).all()
    hits: list[RetrievalChunk] = []
    for chunk, _source in rows:
        hay = " ".join(
            part
            for part in [
                chunk.text or "",
                chunk.caption or "",
                chunk.latex or "",
                chunk.table_md or "",
            ]
            if part
        ).lower()
        if needle in hay:
            hits.append(chunk)
        if len(hits) >= limit:
            break
    return hits


def provider_slice(
    db: Session, subject: str, scope: set[str] | list[str] | None
) -> list[tuple[str, str]]:
    """Distinct (provider, model) stamps under the subject/scope filter.

    Genuine pre-ANN lookup (never a post-fetch filter): the search
    route calls this before ANN to detect a post-ingest provider
    switch (→ 503 EMBED_SPACE_MISMATCH). SQLite path scans the scoped
    base query; the Postgres leg pushes the same filters before the
    DISTINCT in SQL (`space_statement`).
    """
    scope_set = set(scope) if scope else None
    rows = db.execute(_base_query(db, subject, scope_set)).all()
    return sorted({(c.embed_provider, c.embed_model) for c, _s in rows})


_PG_TEXT_KINDS = "('page','diagram','equation','table','text')"


def _pg_scope_fragment(scope: set[str] | list[str] | None) -> str:
    """Shared Postgres scope filter (single builder — no duplication).

    Returns "" (no filter) or " AND (...)". Same predicate family as
    `_scope_predicates`, rendered as SQL so ANN/FTS/space legs share
    one definition.
    """
    scope_set = set(scope) if scope else None
    if not scope_set:
        return ""
    conds: list[str] = []
    if "slides" in scope_set:
        conds.append(
            f"(retrieval_sources.kind = 'slides' AND retrieval_chunks.kind IN {_PG_TEXT_KINDS})"
        )
    if "textbook" in scope_set:
        conds.append(
            "(retrieval_sources.kind IN ('textbook','notes') "
            f"AND retrieval_chunks.kind IN {_PG_TEXT_KINDS})"
        )
    if "lectures" in scope_set:
        conds.append("(retrieval_chunks.kind = 'transcript')")
    if not conds:
        return ""
    if set(scope_set) >= {"slides", "textbook", "lectures"}:
        return ""
    return " AND (" + " OR ".join(conds) + ")"


_PG_JOIN = (
    "FROM retrieval_chunks "
    "JOIN retrieval_sources ON retrieval_sources.id = retrieval_chunks.source_id "
    "WHERE retrieval_sources.subject = :subject"
)


def ann_statement(
    subject: str, scope: set[str] | list[str] | None, query_emb: Sequence[float],
    limit: int = ANN_FTS_LIMIT,
) -> TextClause:
    """Postgres ANN leg: subject + scope WHERE pushed before ORDER BY."""
    _ = query_emb
    sql = (
        "SELECT retrieval_chunks.id " + _PG_JOIN + _pg_scope_fragment(scope) +
        " ORDER BY retrieval_chunks.embedding_v <=> :q LIMIT :limit"
    )
    return text(sql).bindparams(subject=subject)


def fts_statement(
    subject: str, scope: set[str] | list[str] | None, query_text: str,
    limit: int = ANN_FTS_LIMIT,
) -> TextClause:
    """Postgres FTS leg: `tsv @@ plainto_tsquery(:q)` + same filters."""
    _ = query_text
    sql = (
        "SELECT retrieval_chunks.id " + _PG_JOIN + _pg_scope_fragment(scope) +
        " AND retrieval_chunks.tsv @@ plainto_tsquery(:q) LIMIT :limit"
    )
    return text(sql).bindparams(subject=subject)


def space_statement(
    subject: str, scope: set[str] | list[str] | None,
) -> TextClause:
    """Postgres space check: DISTINCT stamps under the same filter."""
    sql = (
        "SELECT DISTINCT retrieval_chunks.embed_provider, retrieval_chunks.embed_model "
        + _PG_JOIN + _pg_scope_fragment(scope)
    )
    return text(sql).bindparams(subject=subject)
