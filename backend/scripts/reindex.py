"""In-place re-embed + re-stamp (spec §7 provider-switch path).

Reads each chunk's text fields, re-embeds with the ACTIVE provider,
and updates both embedding columns + stamps in place (batched,
checkpointed, resumable). Delete-then-insert via `POST /ingest/manifest`
is the equivalent heavier path.

`plan_restamp` is pure (hash-provider dry run in tests); `main` needs
`DATABASE_URL` (direct, never pooled) and never runs in the suite.

Usage (from `backend/`):
  python scripts/reindex.py --batch 32 --limit 0   # full run
  python scripts/reindex.py --dry-run --provider hash --limit 5
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BATCH = 32


def chunk_text_fields(chunk) -> str:
    parts = [
        getattr(chunk, "text", "") or "",
        getattr(chunk, "caption", "") or "",
        getattr(chunk, "latex", "") or "",
        getattr(chunk, "table_md", "") or "",
        " ".join(getattr(chunk, "concepts", None) or []),
    ]
    return " ".join(p for p in (s.strip() for s in parts) if p)


def plan_restamp(stamps: list[tuple[str, str]], active: tuple[str, str]) -> list[int]:
    """Indexes into `stamps` that differ from the active provider/model."""
    return [i for i, stamp in enumerate(stamps) if tuple(stamp) != tuple(active)]


def load_checkpoint(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except OSError:
        return {"done_ids": []}


def save_checkpoint(path: str, state: dict) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Re-embed chunks in place.")
    parser.add_argument("--batch", type=int, default=BATCH)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--provider", default="")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--checkpoint", default=".reindex.ckpt")
    args = parser.parse_args()

    if args.provider:
        os.environ["RETRIEVAL_EMBED_PROVIDER"] = args.provider
    from app.retrieval import chunkstore
    from app.retrieval.embeddings import embed_texts, select_provider

    try:
        provider = select_provider()
    except Exception as exc:
        print(f"Provider unavailable: {exc}", file=sys.stderr)
        return 1
    active = (getattr(provider, "name", ""), getattr(provider, "model", ""))
    state = load_checkpoint(args.checkpoint)
    done = set(state.get("done_ids", []))

    from app.db import get_engine
    from app.models.retrieval import RetrievalChunk
    from sqlalchemy.orm import sessionmaker

    engine = get_engine()
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    db = Session()
    try:
        query = db.query(RetrievalChunk).order_by(RetrievalChunk.created_at)
        if args.limit:
            query = query.limit(args.limit)
        chunks = [c for c in query.all() if str(c.id) not in done]
        stamps = [(c.embed_provider, c.embed_model) for c in chunks]
        stale_idx = plan_restamp(stamps, active)
        print(f"reindex: {len(stale_idx)} stale of {len(chunks)} checked "
              f"(active {active[0]}/{active[1]}).")
        if args.dry_run:
            return 0
        pending = [chunks[i] for i in stale_idx]
        for start in range(0, len(pending), args.batch):
            batch = pending[start:start + args.batch]
            vecs = embed_texts(provider, [chunk_text_fields(c) for c in batch])
            for chunk, vec in zip(batch, vecs):
                chunkstore.persist_chunk_embedding(db, chunk, vec)
                chunk.embed_provider = active[0]
                chunk.embed_model = active[1]
            db.commit()
            done.update(str(c.id) for c in batch)
            save_checkpoint(args.checkpoint, {"done_ids": sorted(done)})
            print(f"reindex: {len(done)} done.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
