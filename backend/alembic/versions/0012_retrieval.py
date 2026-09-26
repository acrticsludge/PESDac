"""0012 retrieval P1 tables + PG-only vector/FTS (spec retrieval-phase1 §4.2).

Portable tables (`retrieval_sources`, `retrieval_chunks`, `ingest_events`)
run on every dialect. The `vector(1024)` column, HNSW index, and `tsv`
generated column run on Postgres only (SQLite tests build schema via
`create_all` and never run migrations — a `vector` type there would
break the whole suite). Guarded by `op.get_bind()` dialect check;
SQLite path no-ops by design.

Sync invariant (§4.2): `embedding` and `embedding_v` are written by ONE
application helper (`persist_chunk_embedding`) in the same txn — never
two writers, never a generated-column cast.

Chain: applies after `0011_rename_math_mfads` (current head).

Run with the DIRECT url (DATABASE_URL, unpooled), never pooled.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0012_retrieval"
down_revision = "0011_rename_math_mfads"
branch_labels = None
depends_on = None


def _is_postgres() -> bool:
    try:
        bind = op.get_bind()
    except Exception:
        return False
    return getattr(getattr(bind, "dialect", None), "name", "") == "postgresql"


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.create_table(
        "retrieval_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("subject", sa.Text(),
                  sa.ForeignKey("subjects.code"), nullable=False),
        sa.Column("unit", sa.String(32), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("r2_key", sa.Text(), nullable=False),
        sa.Column("public_url", sa.Text(), nullable=False,
                  server_default=""),
        sa.Column("page_count", sa.Integer(), nullable=False,
                  server_default="0"),
        sa.Column("version", sa.Integer(), nullable=False,
                  server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("subject", "unit", "kind", "r2_key",
                            name="uq_retrieval_sources_natural"),
    )
    op.create_index("ix_retrieval_sources_subject_unit", "retrieval_sources",
                    ["subject", "unit"])
    op.create_table(
        "retrieval_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("source_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("retrieval_sources.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("page", sa.Integer(), nullable=True),
        sa.Column("bbox", postgresql.JSONB(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("latex", sa.Text(), nullable=True),
        sa.Column("table_md", sa.Text(), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column("concepts", postgresql.JSONB(), nullable=False,
                  server_default="'[]'"),
        sa.Column("video_start", sa.Float(), nullable=True),
        sa.Column("video_end", sa.Float(), nullable=True),
        sa.Column("thumb_url", sa.Text(), nullable=True),
        sa.Column("page_url", sa.Text(), nullable=True),
        sa.Column("embedding", postgresql.JSONB(), nullable=False,
                  server_default="'[]'"),
        sa.Column("embed_provider", sa.String(32), nullable=False,
                  server_default=""),
        sa.Column("embed_model", sa.String(120), nullable=False,
                  server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_retrieval_chunks_source", "retrieval_chunks",
                    ["source_id"])
    op.create_table(
        "ingest_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("curator_user_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("users.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("retrieval_sources.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("client_ingest_key", sa.String(64), nullable=True),
        sa.Column("chunk_count", sa.Integer(), nullable=False,
                  server_default="0"),
        sa.Column("manifest_sha256", sa.String(64), nullable=False,
                  server_default=""),
        sa.Column("embed_provider", sa.String(32), nullable=False,
                  server_default=""),
        sa.Column("embed_model", sa.String(120), nullable=False,
                  server_default=""),
        sa.Column("neurons_estimate", sa.Integer(), nullable=False,
                  server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
        sa.UniqueConstraint("client_ingest_key",
                            name="uq_ingest_events_client_key"),
    )
    op.create_index("ix_ingest_events_source", "ingest_events", ["source_id"])
    op.create_index("ix_ingest_events_curator", "ingest_events",
                    ["curator_user_id"])
    if _is_postgres():
        op.execute(
            "ALTER TABLE retrieval_chunks "
            "ADD COLUMN embedding_v vector(1024)"
        )
        op.execute(
            "CREATE INDEX chunks_hnsw ON retrieval_chunks "
            "USING hnsw (embedding_v vector_cosine_ops)"
        )
        op.execute(
            "ALTER TABLE retrieval_chunks ADD COLUMN tsv tsvector "
            "GENERATED ALWAYS AS (to_tsvector('english', "
            "coalesce(text,'') || ' ' || coalesce(caption,'') || ' ' || "
            "coalesce(latex,''))) STORED"
        )
        op.execute(
            "CREATE INDEX chunks_tsv_gin ON retrieval_chunks USING gin (tsv)"
        )


def downgrade() -> None:
    if _is_postgres():
        op.execute("DROP INDEX IF EXISTS chunks_tsv_gin")
        op.execute("ALTER TABLE retrieval_chunks DROP COLUMN IF EXISTS tsv")
        op.execute("DROP INDEX IF EXISTS chunks_hnsw")
        op.execute(
            "ALTER TABLE retrieval_chunks DROP COLUMN IF EXISTS embedding_v"
        )
    op.drop_index("ix_ingest_events_curator", table_name="ingest_events")
    op.drop_index("ix_ingest_events_source", table_name="ingest_events")
    op.drop_table("ingest_events")
    op.drop_index("ix_retrieval_chunks_source", table_name="retrieval_chunks")
    op.drop_table("retrieval_chunks")
    op.drop_index("ix_retrieval_sources_subject_unit",
                  table_name="retrieval_sources")
    op.drop_table("retrieval_sources")
