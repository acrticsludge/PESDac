"""ChunkStore SQLite path (spec §6.2 step 5, §4.2 sync invariant).

Brute-force cosine over `embedding` JSON + LIKE filter, same LIMIT 30
as the Postgres legs. Postgres SQL is compile-asserted in T4, never
executed here.
"""

from __future__ import annotations

import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db import Base
from app.models.catalog import SUBJECT_SEEDS, Subject
from app.models.retrieval import RetrievalChunk, RetrievalSource
from app.retrieval import chunkstore

_engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
_TestingSession = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False)


def _db():
    Base.metadata.drop_all(bind=_engine)
    Base.metadata.create_all(bind=_engine)
    db = _TestingSession()
    for code, name in SUBJECT_SEEDS:
        db.add(Subject(code=code, display_name=name))
    db.commit()
    return db


def _source(db, subject="CN", kind="slides"):
    src = RetrievalSource(
        subject=subject,
        unit="unit-1",
        kind=kind,
        title="Unit 1",
        r2_key=f"subjects/{subject}/unit-1/file.pdf",
        public_url=f"https://media.example/subjects/{subject}/unit-1/file.pdf",
        page_count=2,
    )
    db.add(src)
    db.commit()
    db.refresh(src)
    return src


def test_persist_chunk_embedding_sets_json_and_round_trips():
    db = _db()
    try:
        src = _source(db)
        chunk = RetrievalChunk(source_id=src.id, kind="text", text="hello")
        db.add(chunk)
        chunkstore.persist_chunk_embedding(db, chunk, [1.0, 0.0, 0.5])
        db.commit()
        db.refresh(chunk)
        assert chunk.embedding == [1.0, 0.0, 0.5]
    finally:
        db.close()


def test_store_chunks_writes_all_rows_with_stamps():
    db = _db()
    try:
        src = _source(db)
        rows = chunkstore.store_chunks(
            db,
            src,
            [
                {"kind": "text", "text": "alpha", "page": 1,
                 "embedding": [1.0, 0.0], "embed_provider": "hash",
                 "embed_model": "hash-1024"},
                {"kind": "text", "text": "beta", "page": 2,
                 "embedding": [0.0, 1.0], "embed_provider": "hash",
                 "embed_model": "hash-1024"},
            ],
        )
        db.commit()
        assert len(rows) == 2
        assert {c.text for c in rows} == {"alpha", "beta"}
        assert all(c.embed_provider == "hash" for c in rows)
    finally:
        db.close()


def test_ann_search_ranks_by_cosine_and_scopes_by_subject():
    db = _db()
    try:
        cn = _source(db, subject="CN")
        os_src = _source(db, subject="OS")
        chunkstore.store_chunks(db, cn, [
            {"kind": "text", "text": "close", "embedding": [1.0, 0.0],
             "embed_provider": "hash", "embed_model": "m"},
            {"kind": "text", "text": "far", "embedding": [0.0, 1.0],
             "embed_provider": "hash", "embed_model": "m"},
        ])
        chunkstore.store_chunks(db, os_src, [
            {"kind": "text", "text": "other-subject", "embedding": [1.0, 0.0],
             "embed_provider": "hash", "embed_model": "m"},
        ])
        db.commit()
        hits = chunkstore.ann_search(db, "CN", None, [1.0, 0.0], limit=30)
        assert [h.text for h in hits] == ["close", "far"]
    finally:
        db.close()


def test_fts_search_matches_text_and_respects_limit():
    db = _db()
    try:
        src = _source(db)
        chunkstore.store_chunks(db, src, [
            {"kind": "text", "text": "bridge rectifier output",
             "embedding": [1.0], "embed_provider": "hash", "embed_model": "m"},
            {"kind": "text", "text": "unrelated paragraph",
             "embedding": [1.0], "embed_provider": "hash", "embed_model": "m"},
        ])
        db.commit()
        hits = chunkstore.fts_search(db, "CN", None, "rectifier", limit=30)
        assert [h.text for h in hits] == ["bridge rectifier output"]
        hits = chunkstore.fts_search(db, "CN", None, "", limit=30)
        assert hits == []
    finally:
        db.close()


def test_provider_slice_reports_distinct_stamps_per_scope():
    db = _db()
    try:
        src = _source(db)
        chunkstore.store_chunks(db, src, [
            {"kind": "text", "text": "a", "embedding": [1.0],
             "embed_provider": "workers-ai", "embed_model": "bge-m3"},
            {"kind": "text", "text": "b", "embedding": [1.0],
             "embed_provider": "workers-ai", "embed_model": "bge-m3"},
            {"kind": "text", "text": "c", "embedding": [1.0],
             "embed_provider": "other", "embed_model": "x"},
        ])
        db.commit()
        stamps = chunkstore.provider_slice(db, "CN", None)
        assert sorted(stamps) == [("other", "x"), ("workers-ai", "bge-m3")]
    finally:
        db.close()


def test_scope_filter_separates_slides_from_transcripts():
    db = _db()
    try:
        slides = _source(db, kind="slides")
        video = RetrievalSource(
            subject="CN", unit="unit-1", kind="video", title="Lecture",
            r2_key="subjects/CN/unit-1/lecture.mp4",
            public_url="https://media.example/subjects/CN/unit-1/lecture.mp4",
            page_count=0,
        )
        db.add(video)
        db.commit()
        db.refresh(video)
        chunkstore.store_chunks(db, slides, [
            {"kind": "text", "text": "slide text", "embedding": [1.0, 0.0],
             "embed_provider": "hash", "embed_model": "m"},
        ])
        chunkstore.store_chunks(db, video, [
            {"kind": "transcript", "text": "spoken words",
             "video_start": 10.0, "video_end": 20.0,
             "embedding": [1.0, 0.0],
             "embed_provider": "hash", "embed_model": "m"},
        ])
        db.commit()
        slide_hits = chunkstore.ann_search(db, "CN", {"slides"}, [1.0, 0.0])
        assert {h.text for h in slide_hits} == {"slide text"}
        lecture_hits = chunkstore.ann_search(db, "CN", {"lectures"}, [1.0, 0.0])
        assert {h.text for h in lecture_hits} == {"spoken words"}
    finally:
        db.close()


def test_slides_scope_excludes_transcript_kind_even_from_slide_source():
    db = _db()
    try:
        slides = _source(db, kind="slides")
        chunkstore.store_chunks(db, slides, [
            {"kind": "text", "text": "slide text", "embedding": [1.0, 0.0],
             "embed_provider": "hash", "embed_model": "m"},
            {"kind": "transcript", "text": "stray transcript",
             "video_start": 1.0, "video_end": 2.0,
             "embedding": [1.0, 0.0],
             "embed_provider": "hash", "embed_model": "m"},
        ])
        db.commit()
        hits = chunkstore.ann_search(db, "CN", {"slides"}, [1.0, 0.0])
        assert {h.text for h in hits} == {"slide text"}
    finally:
        db.close()
