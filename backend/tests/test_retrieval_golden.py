"""Bundle golden ranks T10 (spec §6.2 steps 6-7).

Hash provider is deterministic, so ranks are stable — regression
tripwire, not a quality benchmark.
"""

from __future__ import annotations

import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db import Base
from app.models.catalog import SUBJECT_SEEDS, Subject
from app.models.retrieval import RetrievalSource

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


def _seed_texts(db, texts: list[str], **kw):
    from app.retrieval import chunkstore
    from app.retrieval.embeddings import HashProvider, embed_texts

    src = RetrievalSource(
        subject="CN", unit="unit-1", kind="slides", title="S",
        r2_key=f"subjects/CN/unit-1/{uuid.uuid4().hex}.pdf",
        public_url="https://media.example/x.pdf", page_count=1,
    )
    db.add(src)
    db.commit()
    db.refresh(src)
    p = HashProvider()
    vecs = embed_texts(p, texts)
    items = [
        {"kind": kw.get("kind", "text"), "text": t, "page": i + 1,
         "page_url": "https://media.example/subjects/CN/unit-1/pages/p.png",
         "embedding": v, "embed_provider": "hash", "embed_model": "hash-1024"}
        for i, (t, v) in enumerate(zip(texts, vecs))
    ]
    rows = chunkstore.store_chunks(db, src, items)
    db.commit()
    return src, rows


def test_golden_exact_match_ranks_first():
    from app.retrieval import chunkstore
    from app.retrieval import rrf as rrf_mod
    from app.retrieval.embeddings import HashProvider, embed_texts

    db = _db()
    try:
        _seed_texts(db, ["alpha bravo", "charlie delta", "echo foxtrot"])
        p = HashProvider()
        q = embed_texts(p, ["charlie delta"])[0]
        ann = chunkstore.ann_search(db, "CN", None, q)
        assert ann[0].text == "charlie delta"
        fused = rrf_mod.rrf_fuse([c.id for c in ann], [], k=60)
        bundle = rrf_mod.build_bundle(db, fused, topK=3)
        assert bundle[0]["text"] == "charlie delta"
    finally:
        db.close()


def test_mmr_keeps_kind_diversity_on_shared_page():
    from app.retrieval import rrf as rrf_mod

    db = _db()
    try:
        from app.retrieval import chunkstore

        src = RetrievalSource(
            subject="CN", unit="unit-1", kind="slides", title="S",
            r2_key="subjects/CN/unit-1/s.pdf",
            public_url="https://media.example/x.pdf", page_count=1,
        )
        db.add(src)
        db.commit()
        db.refresh(src)
        rows = chunkstore.store_chunks(db, src, [
            {"kind": "equation", "page": 7, "latex": f"e{i}",
             "thumb_url": "https://media.example/subjects/CN/unit-1/pages/e.png",
             "page_url": "https://media.example/subjects/CN/unit-1/pages/p.png",
             "embedding": [1.0], "embed_provider": "hash", "embed_model": "m"}
            for i in range(3)
        ] + [
            {"kind": "text", "page": 9, "text": "other page",
             "page_url": "https://media.example/subjects/CN/unit-1/pages/q.png",
             "embedding": [1.0], "embed_provider": "hash", "embed_model": "m"},
        ])
        db.commit()
        ranked = [(rows[0].id, 3.0), (rows[1].id, 2.0), (rows[2].id, 1.0), (rows[3].id, 0.5)]
        bundle = rrf_mod.build_bundle(db, dict(ranked), topK=2)
        kinds = [b["kind"] for b in bundle]
        assert "text" in kinds
    finally:
        db.close()


def test_bundle_cap_drops_whole_chunks_first():
    from app.retrieval import rrf as rrf_mod

    db = _db()
    try:
        big = "x" * 10000
        _seed_texts(db, [big + "a", big + "b", big + "c"])
        from app.retrieval import chunkstore
        from app.retrieval.embeddings import HashProvider, embed_texts

        p = HashProvider()
        q = embed_texts(p, [big + "a"])[0]
        ann = chunkstore.ann_search(db, "CN", None, q)
        fused = rrf_mod.rrf_fuse([c.id for c in ann], [], k=60)
        bundle = rrf_mod.build_bundle(db, fused, topK=10, max_chars=24000)
        total = sum(len(b["text"] or "") for b in bundle)
        assert total <= 24000
        assert len(bundle) == 2
        assert bundle[0]["text"] == big + "a"
    finally:
        db.close()


def test_transcript_shapes_video_block():
    from app.retrieval import rrf as rrf_mod

    db = _db()
    try:
        from app.retrieval import chunkstore

        src = RetrievalSource(
            subject="CN", unit="unit-1", kind="video", title="L",
            r2_key="subjects/CN/unit-1/lecture.mp4",
            public_url="https://media.example/subjects/CN/unit-1/lecture.mp4",
            page_count=0,
        )
        db.add(src)
        db.commit()
        db.refresh(src)
        rows = chunkstore.store_chunks(db, src, [{
            "kind": "transcript", "text": "spoken",
            "video_start": 872.0, "video_end": 907.0,
            "embedding": [1.0], "embed_provider": "hash", "embed_model": "m",
        }])
        db.commit()
        bundle = rrf_mod.build_bundle(db, {rows[0].id: 1.0}, topK=5)
        assert bundle[0]["video"] == {
            "url": "https://media.example/subjects/CN/unit-1/lecture.mp4",
            "start": 872.0,
            "end": 907.0,
        }
        assert bundle[0]["page"] is None
    finally:
        db.close()
