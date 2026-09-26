"""Reindex dry run (spec §7): stale-stamp planning with hash provider."""

from __future__ import annotations

import sys
from types import SimpleNamespace

sys.path.insert(0, "scripts")


def test_plan_restamp_flags_only_foreign_stamps():
    from reindex import plan_restamp

    stamps = [
        ("hash", "hash-1024"),
        ("workers-ai", "baai/bge-m3"),
        ("hash", "hash-1024"),
    ]
    assert plan_restamp(stamps, ("hash", "hash-1024")) == [1]
    assert plan_restamp(stamps, ("workers-ai", "baai/bge-m3")) == [0, 2]
    assert plan_restamp([], ("hash", "hash-1024")) == []


def test_hash_provider_embeds_text_fields_deterministically():
    from reindex import chunk_text_fields

    from app.retrieval.embeddings import HashProvider

    chunk = SimpleNamespace(
        text="bridge rectifier", caption="diagram", latex="",
        table_md="", concepts=["diode"],
    )
    text = chunk_text_fields(chunk)
    assert "bridge rectifier" in text and "diode" in text
    p = HashProvider()
    assert p.embed([text]) == p.embed([text])
    assert len(p.embed([text])[0]) == 1024
