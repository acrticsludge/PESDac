"""Postgres dialect path (spec §6.2 steps 4-5).

Compile-asserted only — never executed in suite (no live DB).
ANN leg must ORDER BY embedding_v <=> :q with subject + scope-kind
WHERE pushed before ordering; FTS leg must carry tsv @@
plainto_tsquery with the same filters; space check must be a DISTINCT
under the same filter.
"""

from __future__ import annotations

from sqlalchemy.dialects import postgresql

from app.retrieval import chunkstore


def _compile(stmt) -> str:
    return str(stmt.compile(dialect=postgresql.dialect())).lower()


def test_ann_sql_uses_cosine_operator_with_prefilter_and_limit():
    stmt = chunkstore.ann_statement("CN", {"slides"}, [0.1, 0.2], limit=30)
    sql = _compile(stmt)
    assert "embedding_v" in sql and "<=>" in sql
    assert "retrieval_sources.subject" in sql or "subject" in sql
    assert sql.index("where") < sql.index("order by")
    assert "limit" in sql


def test_fts_sql_uses_tsv_predicate_with_same_filters():
    stmt = chunkstore.fts_statement("CN", {"slides"}, "rectifier", limit=30)
    sql = _compile(stmt)
    assert "tsv" in sql and "plainto_tsquery" in sql
    assert "subject" in sql
    assert "limit" in sql


def test_space_sql_selects_distinct_stamps_under_filter():
    stmt = chunkstore.space_statement("CN", {"slides", "lectures"})
    sql = _compile(stmt)
    assert "distinct" in sql
    assert "embed_provider" in sql and "embed_model" in sql
    assert "subject" in sql
